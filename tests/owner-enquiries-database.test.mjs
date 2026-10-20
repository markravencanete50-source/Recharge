import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Owner enquiries (migration 20261022300000): an owner's "Add a property enquiry" in the app lands in Client enquiries as a
// form answer does (answered, To value), marked as from an existing owner and linked to their account, with Priority,
// duplicates, photos and videos the public form's way; the team values it, publishes the estimate (the owner is told in
// the app), and the owner's Proceed carries on with the property already on their account. A rate out of order says
// which rate instead of "Invalid estimate".
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, valuationDraft, enquiryStep, isPriority, isOwnerEnquiry } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { journeyActionSchema, journeyValidationField, RATE_ORDER_MESSAGES } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { newEnquiryForm, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const MINE = '20261022300000_owner_enquiries.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes(MINE));
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_journey_action(jsonb)', 'private.workspace_client_enquiry_view(private.workspace_client_enquiries)', 'private.workspace_owner_enquiry_record(uuid,jsonb)', 'private.workspace_owner_enquiry_files(jsonb)', 'public.workspace_owner_enquiry_files(jsonb)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definitions();

const roles = ['super_admin', 'admin', 'stays', 'client', 'client', 'cleans'];
const users = roles.map((_, i) => `97720000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER_OWNER, CLEANER] = roles.map((_, i) => i);
const session = i => users[i].replace('9772', '9872');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `oe${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Jamie Owner', 'Other Owner', 'Isla'][i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
  for (const m of ['property-onboarding', 'client-dashboard']) await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [users[i], m]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asServer() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const journey = async (i, input) => { await as(i); return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]); };
const rawJourney = async (i, input) => { await as(i); return rpc('workspace_journey_action', [{ requestId: crypto.randomUUID(), ...input }]); };
const act = async (i, input) => { await as(i); return rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]); };
const read = async (i = ADMIN) => { await as(i); return clientEnquiriesSchema.parse(await rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null])); };
const files = async (i, input) => { await as(i); return rpc('workspace_owner_enquiry_files', [input]); };
const notified = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const hash = token => createHash('sha256').update(token).digest('hex');
after(async () => { await db.close(); await vite.close(); });

// What the owner's sheet sends: the app's own form, read and built as the app does.
let streets = 0;
async function ownerEnquiry(i = OWNER, over = {}) {
  const form = newEnquiryForm(false), n = ++streets;
  const raw = { address: `${n} Owner Lane, Leith, Edinburgh EH6 ${n}AB`, name: `Owner Lane ${n}`, region: '', propertyType: 'Flat', bedrooms: '2', wcs: '1', bathrooms: '1', parking: 'Driveway', garden: '', photoLink: '', notes: 'Keys with the neighbour', startWhen: '', ...over };
  const body = form.build(workflowValues(form.fields, raw), crypto.randomUUID());
  return journey(i, body);
}
const enquiryOf = async propertyId => (await read()).items.find(e => e.propertyId === propertyId);

test('the patched and new functions are the same after a second run', () => {
  assert.deepEqual(secondRun, firstRun);
  for (const d of firstRun) assert.ok(!d.includes('\u2014'), 'no em dash');
});

test('only the owner, signed in, may add files; the internal record is never callable', async () => {
  const can = async (role, fn) => (await sql('select has_function_privilege($1,$2,\'execute\') ok', [role, fn]))[0].ok;
  assert.equal(await can('anon', 'public.workspace_owner_enquiry_files(jsonb)'), false, 'anon');
  assert.equal(await can('authenticated', 'public.workspace_owner_enquiry_files(jsonb)'), true);
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await can(role, 'private.workspace_owner_enquiry_record(uuid,jsonb)'), false, role);
  const [wrapper] = await sql("select prosecdef from pg_proc where oid='public.workspace_owner_enquiry_files(jsonb)'::regprocedure");
  assert.equal(wrapper.prosecdef, false, 'the public wrapper runs as the caller');
});

test("an owner's enquiry lands in Client enquiries as an answered form, from an existing owner, on their account", async () => {
  const j = await ownerEnquiry(OWNER, { startWhen: 'As soon as possible' });
  assert.equal(j.clientId, users[OWNER], 'the property is on their account straight away');
  assert.equal(j.stage, 'enquiry');
  const e = await enquiryOf(j.propertyId);
  assert.ok(e, 'it is in Client enquiries');
  assert.equal(e.source, 'owner_app'); assert.equal(e.ownerId, users[OWNER]); assert.ok(isOwnerEnquiry(e));
  assert.equal(e.status, 'received'); assert.equal(enquiryStep(e), 'received', 'To value, like an answered form');
  assert.ok(isPriority(e, enquiryStep(e)), 'As soon as possible is Priority, as on the form');
  assert.equal(e.answers.fullName, 'Jamie Owner'); assert.equal(e.answers.email, 'oe3@example.com');
  assert.equal(e.answers.propertyType, 'Flat'); assert.equal(e.answers.bedrooms, 2); assert.equal(e.answers.bathrooms, 1); assert.equal(e.answers.wcs, 1);
  assert.equal(e.answers.parking, 'Driveway'); assert.equal(e.answers.notes, 'Keys with the neighbour'); assert.equal(e.answers.startWhen, 'As soon as possible');
  assert.equal(e.duplicateReason, null, 'not a duplicate of anything');
  // Forms the team sends stay as they were.
  assert.ok((await read()).items.filter(x => !isOwnerEnquiry(x)).every(x => x.source === 'form' && x.ownerId === null));
  // A later choice is not Priority, and no choice is fine.
  const later = await enquiryOf((await ownerEnquiry(OWNER, { startWhen: 'Not sure yet' })).propertyId);
  assert.equal(isPriority(later, enquiryStep(later)), false);
  const none = await enquiryOf((await ownerEnquiry(OWNER)).propertyId);
  assert.equal(none.answers.startWhen, undefined);
});

test('a start time that is not one of the choices is refused, and nothing is made', async () => {
  const before = (await sql('select count(*)::int n from public.workspace_properties'))[0].n;
  await assert.rejects(rawJourney(OWNER, { action: 'createEnquiry', name: 'Bad start', address: '9 Bad Start Road, Edinburgh', propertyType: 'Flat', bedrooms: 1, bathrooms: 1, startWhen: 'Tomorrow' }), /Choose when you would like to get started/);
  assert.equal((await sql('select count(*)::int n from public.workspace_properties'))[0].n, before);
});

test("an enquiry the team adds by hand is not an owner's (since 20261022400000 it is recorded as the team's)", async () => {
  const before = (await sql('select count(*)::int n from private.workspace_client_enquiries'))[0].n;
  const j = await journey(ADMIN, { action: 'createEnquiry', name: 'Team added', address: '4 Team Road, Glasgow G1 1AA', propertyType: 'Flat', bedrooms: 1, bathrooms: 1, enquiry: { contactName: 'Pat Caller', phone: '07700 900111' } });
  assert.equal(j.clientId, null);
  assert.equal((await sql('select count(*)::int n from private.workspace_client_enquiries'))[0].n, before + 1, 'one row, the team\'s');
  const e = await enquiryOf(j.propertyId);
  assert.equal(e.source, 'team'); assert.equal(e.ownerId, null); assert.equal(isOwnerEnquiry(e), false);
});

test('duplicates work as on the form: the same address first, else an open form answer with their email', async () => {
  const first = await ownerEnquiry(OWNER);
  const [p] = await sql('select address from public.workspace_properties where id=$1', [first.propertyId]);
  const admins = await notified(ADMIN, 'enquiry.duplicate');
  const again = await rawJourney(OTHER_OWNER, { action: 'createEnquiry', name: 'Same place', address: p.address, propertyType: 'Flat', bedrooms: 2, bathrooms: 1 });
  const e = await enquiryOf(again.propertyId);
  assert.equal(e.duplicateReason, 'same_address'); assert.equal(e.duplicateOf, first.propertyId);
  assert.equal(await notified(ADMIN, 'enquiry.duplicate'), admins + 1, 'the admins are told, as for the form');

  // The other owner also answered the public form with the same email.
  const t = 'owner-form-token';
  await as(ADMIN);
  const sent = await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Other Owner', email: 'oe4@example.com', subject: 'Your free estimate', body: 'Hello {form link}', delivery: 'link' }), tokenHash: hash(t) }]);
  await asServer();
  const answers = enquiryAnswersSchema.parse({ fullName: 'Other Owner', email: 'oe4@example.com', phone: '07700 900222', propertyAddress: '77 Form Street, Edinburgh EH1 1AA', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1, parking: 'None', garden: 'None', shortLet: 'no', furnishQuote: 'no', compliance: 'no', startWhen: 'Within a month', enquiryType: "I'd like a free performance estimate" });
  assert.deepEqual(await rpc('workspace_enquiry_public', [{ action: 'submit', tokenHash: hash(t), answers }]), { state: 'answered' });
  const contact = await enquiryOf((await rawJourney(OTHER_OWNER, { action: 'createEnquiry', name: 'Somewhere new', address: '5 Brand New Street, Perth PH1 1AA', propertyType: 'House', bedrooms: 3, bathrooms: 2 })).propertyId);
  assert.equal(contact.duplicateReason, 'same_contact');
  const [formRow] = await sql('select property_id from private.workspace_client_enquiries where id=$1', [sent.id]);
  assert.equal(contact.duplicateOf, formRow.property_id, 'pointing at the property from the form');
  // Their own earlier app enquiry is who they are, not a duplicate contact.
  const own = await enquiryOf((await ownerEnquiry(OWNER)).propertyId);
  assert.equal(own.duplicateReason, null);
});

test("photos and videos go on the owner's own enquiry with the public form's limits", async () => {
  const j = await ownerEnquiry(OWNER);
  const e = await enquiryOf(j.propertyId);
  assert.deepEqual(await files(OWNER, { action: 'open', propertyId: j.propertyId }), { id: e.id, files: 0 });
  const file = (n, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, path: `enquiries/${e.id}/00000000-0000-4000-8000-${String(n).padStart(12, '0')}.jpg`, name: `photo${n}.jpg`, mime: 'image/jpeg', bytes: 1000, ...extra });
  assert.deepEqual(await files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(1) }), { id: file(1).id });
  await files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(2, { mime: 'video/mp4', path: `enquiries/${e.id}/${file(2).id}.mp4`, name: 'walkround.mp4' }) });
  const seen = await enquiryOf(j.propertyId);
  assert.deepEqual(seen.files.map(f => f.name), ['photo1.jpg', 'walkround.mp4'], 'the team sees them on the enquiry');
  // The same checks as the form: path, type and size.
  await assert.rejects(files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(3, { path: `enquiries/${crypto.randomUUID()}/${file(3).id}.jpg` }) }), /Invalid file/);
  await assert.rejects(files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(3, { mime: 'application/pdf' }) }), /Invalid file/);
  await assert.rejects(files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(3, { bytes: 26214401 }) }), /Invalid file/);
  for (let n = 3; n <= 15; n++) await files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(n) });
  await assert.rejects(files(OWNER, { action: 'addFile', propertyId: j.propertyId, file: file(16) }), /Up to 15/);
  assert.deepEqual(await files(OWNER, { action: 'removeFile', propertyId: j.propertyId, fileId: file(1).id }), { path: file(1).path });
  assert.equal((await enquiryOf(j.propertyId)).files.length, 14);
  // Nobody else: another owner, the team, a cleaner.
  for (const i of [OTHER_OWNER]) await assert.rejects(files(i, { action: 'open', propertyId: j.propertyId }), /Enquiry not found/);
  for (const i of [ADMIN, STAYS, CLEANER]) await assert.rejects(files(i, { action: 'open', propertyId: j.propertyId }), /Only the owner/);
  // The total stays under 250 MB.
  const big = await ownerEnquiry(OWNER), be = await enquiryOf(big.propertyId);
  for (let n = 1; n <= 10; n++) await files(OWNER, { action: 'addFile', propertyId: big.propertyId, file: { ...file(100 + n), path: `enquiries/${be.id}/${file(100 + n).id}.jpg`, bytes: 25 * 1024 * 1024 } });
  await assert.rejects(files(OWNER, { action: 'addFile', propertyId: big.propertyId, file: { ...file(200), path: `enquiries/${be.id}/${file(200).id}.jpg`, bytes: 1 } }), /more than we can take/);
});

test('valued, estimated and proceeded the same way, with the property staying on their account', async () => {
  const j = await ownerEnquiry(OWNER, { startWhen: 'Within a month' });
  const e = await enquiryOf(j.propertyId);
  const valued = await act(STAYS, { action: 'startValuing', enquiryId: e.id, version: e.version, ...valuationDraft(e.answers) });
  assert.equal(valued.status, 'valuing');
  assert.equal(valued.propertyId, j.propertyId, 'the same property, nothing new made');
  const [after] = await sql('select client_id,stage from private.workspace_journeys where property_id=$1', [j.propertyId]);
  assert.deepEqual([after.client_id, after.stage], [users[OWNER], 'enquiry']);
  // Files stop once it is past valuing (estimate published).
  const told = await notified(OWNER, 'journey.publishEstimate');
  let now = await journey(STAYS, { action: 'publishEstimate', propertyId: j.propertyId, version: (await sql('select version from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].version, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });
  assert.equal(now.stage, 'estimate');
  assert.equal(await notified(OWNER, 'journey.publishEstimate'), told + 1, 'the owner is told in the app');
  const shown = await enquiryOf(j.propertyId);
  assert.equal(enquiryStep(shown), 'estimate', 'Client enquiries follows it on');
  now = await journey(OWNER, { action: 'decideEstimate', propertyId: j.propertyId, version: now.version, decision: 'proceed' });
  assert.equal(now.stage, 'agreement');
  assert.equal(now.clientId, users[OWNER]);
  assert.equal((await sql("select count(*)::int n from public.workspace_profiles where role='client'"))[0].n, 2, 'no second account');
});

test('a rate out of order says which rate; the other estimate checks are unchanged', async () => {
  const j = await ownerEnquiry(OWNER);
  const version = async () => (await sql('select version from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].version;
  // Lee's screenshot (16 October): the owner's costs were fine; the expected rate was below the low one.
  const ownCosts = [['Mortgage or rent', 10000], ['Insurance', 10000], ['Utilities', 10000], ['Council tax', 15000], ['Other', 25000]].map(([category, monthlyMinor]) => ({ category, monthlyMinor }));
  const base = { action: 'publishEstimate', propertyId: j.propertyId, comparables: [], comments: '', ownCosts };
  await assert.rejects(rawJourney(STAYS, { ...base, version: await version(), lowRateMinor: 12000, mediumRateMinor: 10000, highRateMinor: 15000 }), new RegExp(RATE_ORDER_MESSAGES.mediumRateMinor));
  await assert.rejects(rawJourney(STAYS, { ...base, version: await version(), lowRateMinor: 9000, mediumRateMinor: 12000, highRateMinor: 11000 }), new RegExp(RATE_ORDER_MESSAGES.highRateMinor));
  await assert.rejects(rawJourney(STAYS, { ...base, version: await version(), lowRateMinor: 50, mediumRateMinor: 12000, highRateMinor: 15000 }), /Invalid estimate/);
  await assert.rejects(rawJourney(STAYS, { ...base, version: await version(), lowRateMinor: 9000, mediumRateMinor: 12000, highRateMinor: 15000, comparables: Array.from({ length: 21 }, (_, i) => ({ name: 'C' + i, url: 'https://example.com/' + i, adrMinor: 100 })) }), /Invalid estimate/);
  const ok = await rawJourney(STAYS, { ...base, version: await version(), lowRateMinor: 9000, mediumRateMinor: 9000, highRateMinor: 9000 });
  assert.equal(ok.stage, 'estimate', 'equal rates are in order');
  assert.deepEqual(ok.estimate.ownCosts, ownCosts);
});

// Item 7: the owner's repair limit at Proceed, saved in Limit Changer's table unless a limit is already set.
const limitOf = async propertyId => (await sql('select limit_minor,full_permission,updated_by from private.workspace_repair_limits where property_id=$1', [propertyId]))[0] ?? null;
const historyOf = async propertyId => sql('select changed_by,before,after from private.workspace_repair_limit_history where property_id=$1 order by id', [propertyId]);
async function atEstimate(i = OWNER) {
  const j = await ownerEnquiry(i);
  const version = (await sql('select version from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].version;
  return journey(STAYS, { action: 'publishEstimate', propertyId: j.propertyId, version, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });
}
const proceed = async (j, repairLimitMinor, i = OWNER) => journey(i, { action: 'decideEstimate', propertyId: j.propertyId, version: j.version, decision: 'proceed', ...(repairLimitMinor === undefined ? {} : { repairLimitMinor }) });

test('item 7: the patched functions are the same after a second run, and the helpers are internal', async () => {
  const sigs = ['private.workspace_estimate_public(jsonb)', 'private.workspace_journey_view(private.workspace_journeys)', 'private.workspace_owner_repair_limit_check(jsonb)', 'private.workspace_owner_repair_limit_apply(uuid,uuid,uuid)', 'private.workspace_owner_repair_limit_on_owner()'];
  const defs = () => Promise.all(sigs.map(async s => (await sql('select pg_get_functiondef($1::regprocedure) d', [s]))[0].d));
  const before = await defs();
  await db.exec('reset role');
  await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
  assert.deepEqual(await defs(), before);
  assert.equal((await sql("select count(*)::int n from pg_trigger where tgname='workspace_journeys_owner_repair_limit'"))[0].n, 1, 'one trigger');
  for (const fn of sigs.slice(2)) for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await sql("select has_function_privilege($1,$2,'execute') ok", [role, fn]))[0].ok, false, fn + ' ' + role);
});

test('item 7: Proceed in the app saves the default, each choice and a custom amount as the limit, marked as the owner', async () => {
  for (const amount of [10000, 0, 25000, 50000, 30000]) {
    const j = await atEstimate();
    const after = await proceed(j, amount);
    assert.equal(after.ownerRepairLimit.limitMinor, amount);
    assert.equal(after.ownerRepairLimit.via, 'app');
    assert.deepEqual(await limitOf(j.propertyId), { limit_minor: amount, full_permission: false, updated_by: users[OWNER] });
    const [h, ...more] = await historyOf(j.propertyId);
    assert.equal(more.length, 0);
    assert.deepEqual([h.changed_by, h.before, h.after], [users[OWNER], null, { limitMinor: amount, fullPermission: false, setBy: 'owner', at: 'proceed', via: 'app' }]);
    // Limit Changer shows it as set, by the owner, and a super admin can still change it.
    await as(SUPER);
    const row = (await rpc('workspace_repair_limits_read')).owners.flatMap(o => o.properties).find(r => r.propertyId === j.propertyId);
    assert.deepEqual([row.limitMinor, row.source, row.updatedBy, row.updatedByName], [amount, 'set', users[OWNER], 'Jamie Owner']);
    await rpc('workspace_repair_limits_action', [{ requestId: crypto.randomUUID(), action: 'setRepairLimit', propertyIds: [j.propertyId], limitMinor: 75000, fullPermission: false }]);
    assert.equal((await limitOf(j.propertyId)).limit_minor, 75000);
  }
  // The team sees the choice on the enquiry too.
  assert.ok((await read()).items.find(e => e.ownerRepairLimit?.limitMinor === 30000), 'on the enquiry');
});

test('item 7: an amount that is not whole pounds, or over the maximum, is refused and nothing changes', async () => {
  const j = await atEstimate();
  for (const bad of [12345, 10000100, -100, '100', 1.5]) {
    await assert.rejects(rawJourney(OWNER, { action: 'decideEstimate', propertyId: j.propertyId, version: j.version, decision: 'proceed', repairLimitMinor: bad }), /Choose the repair limit in whole pounds/, String(bad));
  }
  const [still] = await sql('select stage,owner_repair_limit from private.workspace_journeys where property_id=$1', [j.propertyId]);
  assert.deepEqual([still.stage, still.owner_repair_limit], ['estimate', null]);
  assert.equal(await limitOf(j.propertyId), null);
  // The server names the field before the database is asked.
  const parsed = journeyActionSchema.safeParse({ action: 'decideEstimate', requestId: crypto.randomUUID(), propertyId: j.propertyId, version: j.version, decision: 'proceed', repairLimitMinor: 12345 });
  assert.equal(journeyValidationField(parsed.error), 'repairLimitMinor');
  assert.equal(parsed.error.issues[0].message, 'Choose the repair limit in whole pounds, from 0 to 100,000');
  // Without the question (an older app), Proceed works as before and sets nothing; a decline ignores it.
  assert.equal((await proceed(j, undefined)).stage, 'agreement');
  assert.equal(await limitOf(j.propertyId), null);
  const declined = await atEstimate();
  await journey(OWNER, { action: 'decideEstimate', propertyId: declined.propertyId, version: declined.version, decision: 'decline', feedback: 'Selling instead', repairLimitMinor: 25000 });
  assert.equal(await limitOf(declined.propertyId), null);
});

test('item 7: a limit a super admin already set is kept, and nothing is recorded', async () => {
  const j = await atEstimate();
  await as(SUPER);
  await rpc('workspace_repair_limits_action', [{ requestId: crypto.randomUUID(), action: 'setRepairLimit', propertyIds: [j.propertyId], limitMinor: 20000, fullPermission: false }]);
  const before = await historyOf(j.propertyId);
  const after = await proceed(j, 50000);
  assert.equal(after.ownerRepairLimit.limitMinor, 50000, 'the choice is still shown to the team');
  assert.deepEqual(await limitOf(j.propertyId), { limit_minor: 20000, full_permission: false, updated_by: users[SUPER] });
  assert.deepEqual(await historyOf(j.propertyId), before);
});

test('item 7: from the private estimate page it is kept, then saved when the owner account is linked', async () => {
  let j = await journey(ADMIN, { action: 'createEnquiry', name: 'Link flat', address: '8 Link Street, Dundee DD1 1AA', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, enquiry: { contactName: 'Lena Link', email: 'lena@example.com' } });
  j = await journey(ADMIN, { action: 'publishEstimate', propertyId: j.propertyId, version: j.version, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });
  const tokenHash = hash('link-limit-token');
  await as(ADMIN);
  await db.query('select public.workspace_estimate_link_action($1::jsonb)', [JSON.stringify({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash, delivery: 'link' })]);
  const pub = async input => { await asServer(); return rpc('workspace_estimate_public', [input]); };
  await assert.rejects(pub({ action: 'decide', tokenHash, decision: 'proceed', feedback: '', repairLimitMinor: 99 }), /Choose the repair limit in whole pounds/);
  assert.equal((await pub({ action: 'decide', tokenHash, decision: 'proceed', feedback: '', repairLimitMinor: 25000 })).state, 'proceeding');
  const [kept] = await sql('select owner_repair_limit o from private.workspace_journeys where property_id=$1', [j.propertyId]);
  assert.deepEqual([kept.o.limitMinor, kept.o.via], [25000, 'link']);
  assert.equal(await limitOf(j.propertyId), null, 'no person to record it against yet');
  // The server makes and links the owner's account (lib/owner-account-server.ts).
  await asServer();
  assert.equal((await rpc('workspace_owner_account', [{ action: 'prepare', tokenHash }])).state, 'ready');
  const id = crypto.randomUUID();
  await sql('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())', [id, 'lena@example.com', JSON.stringify({ full_name: '' })]);
  await asServer();
  await rpc('workspace_owner_account', [{ action: 'link', tokenHash, userId: id, created: true }]);
  assert.deepEqual(await limitOf(j.propertyId), { limit_minor: 25000, full_permission: false, updated_by: id });
  const [h, ...more] = await historyOf(j.propertyId);
  assert.equal(more.length, 0);
  assert.deepEqual([h.changed_by, h.after], [id, { limitMinor: 25000, fullPermission: false, setBy: 'owner', at: 'proceed', via: 'link' }]);
  // A retry of the link changes nothing.
  await asServer();
  await rpc('workspace_owner_account', [{ action: 'link', tokenHash, userId: id, created: false }]);
  assert.equal((await historyOf(j.propertyId)).length, 1);
});
