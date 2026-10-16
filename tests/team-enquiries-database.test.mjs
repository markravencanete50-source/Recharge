import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Team enquiries (migration 20261022400000): an enquiry the team adds by hand (after a phone call, say) lands in Client
// enquiries as an answered form does (To value), marked as added by the team and by whom, with Priority and duplicates
// the public form's way; the team values it, publishes the estimate, and the owner's Proceed makes their account as for
// any enquiry without one.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, valuationDraft, enquiryStep, isPriority, isOwnerEnquiry, isTeamEnquiry, teamEnquiryTag } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { newEnquiryForm, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const MINE = '20261022400000_team_enquiries.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes(MINE));
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_journey_action(jsonb)', 'private.workspace_team_enquiry_record(uuid,jsonb)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definitions();

const roles = ['super_admin', 'admin', 'stays', 'client', 'cleans'];
const users = roles.map((_, i) => `97730000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, CLEANER] = roles.map((_, i) => i);
const session = i => users[i].replace('9773', '9873');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `te${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Jamie Owner', 'Isla'][i]]);
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
const notified = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const rows = async () => (await sql('select count(*)::int n from private.workspace_client_enquiries'))[0].n;
const hash = token => createHash('sha256').update(token).digest('hex');
after(async () => { await db.close(); await vite.close(); });

// What the team's form sends: the app's own form, read and built as the app does.
let streets = 0;
async function teamEnquiry(i = ADMIN, over = {}) {
  const form = newEnquiryForm(true), n = ++streets;
  const raw = { contactName: 'Pat Caller', companyName: '', email: `pat${n}@example.com`, phone: '07700 900111', address: `${n} Team Road, Glasgow G1 ${n}AA`, name: `Team Road ${n}`, region: '', propertyType: 'Flat', bedrooms: '2', wcs: '1', bathrooms: '1', parking: 'On street', garden: '', photoLink: '', notes: 'Called on Monday', startWhen: '', ...over };
  const body = form.build(workflowValues(form.fields, raw), crypto.randomUUID());
  return journey(i, body);
}
const enquiryOf = async propertyId => (await read()).items.find(e => e.propertyId === propertyId);
const version = async propertyId => (await sql('select version from private.workspace_journeys where property_id=$1', [propertyId]))[0].version;

test('the patched and new functions are the same after a second run, and the record is internal', async () => {
  assert.deepEqual(secondRun, firstRun);
  for (const d of firstRun) assert.ok(!d.includes('\u2014'), 'no em dash');
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await sql("select has_function_privilege($1,'private.workspace_team_enquiry_record(uuid,jsonb)','execute') ok", [role]))[0].ok, false, role);
});

test("an enquiry the team adds lands in Client enquiries as an answered form, marked as the team's and by whom", async () => {
  const j = await teamEnquiry(ADMIN, { companyName: 'Caller Lets Ltd', startWhen: 'As soon as possible' });
  assert.equal(j.clientId, null); assert.equal(j.stage, 'enquiry');
  const e = await enquiryOf(j.propertyId);
  assert.ok(e, 'it is in Client enquiries, linked to the property made');
  assert.equal(e.source, 'team'); assert.ok(isTeamEnquiry(e)); assert.equal(isOwnerEnquiry(e), false); assert.equal(e.ownerId, null);
  assert.equal(e.sentBy, users[ADMIN]); assert.equal(e.sentByName, 'Morag');
  assert.equal(teamEnquiryTag(e), 'Added by the team · Morag');
  assert.equal(e.status, 'received'); assert.equal(enquiryStep(e), 'received', 'To value');
  assert.ok(isPriority(e, enquiryStep(e)), 'As soon as possible is Priority, as on the form');
  assert.deepEqual(e.answers, { fullName: 'Pat Caller', companyName: 'Caller Lets Ltd', email: `pat${streets}@example.com`, phone: '07700 900111', propertyAddress: `${streets} Team Road, Glasgow G1 ${streets}AA`,
    propertyType: 'Flat', bedrooms: 2, bathrooms: 1, wcs: 1, parking: 'On street', notes: 'Called on Monday', startWhen: 'As soon as possible' });
  assert.equal(e.recipientEmail, `pat${streets}@example.com`);
  assert.equal(e.duplicateReason, null);
  // Guest relations add them too, under their own name; a later start is not Priority.
  const s = await enquiryOf((await teamEnquiry(STAYS, { startWhen: 'Not sure yet' })).propertyId);
  assert.deepEqual([s.source, s.sentByName, isPriority(s, enquiryStep(s))], ['team', 'Fiona', false]);
});

test('a phone number alone is enough; an owner account chosen by the team gives the name and email', async () => {
  const phone = await enquiryOf((await teamEnquiry(ADMIN, { email: '' })).propertyId);
  assert.equal(phone.answers.email, ''); assert.equal(phone.answers.phone, '07700 900111'); assert.equal(phone.recipientEmail, 'no email');
  // An existing owner: no contact details needed; the property goes on their account, the row stays the team's.
  const j = await journey(ADMIN, { action: 'createEnquiry', clientId: users[OWNER], name: 'Owner second flat', address: '12 Owner Street, Edinburgh EH3 1AA', propertyType: 'Flat', bedrooms: 1, bathrooms: 1 });
  assert.equal(j.clientId, users[OWNER]);
  const e = await enquiryOf(j.propertyId);
  assert.deepEqual([e.source, e.ownerId, e.answers.fullName, e.answers.email], ['team', null, 'Jamie Owner', 'te3@example.com']);
});

test('a start time that is not one of the choices is refused, and nothing is made', async () => {
  const [props, before] = [(await sql('select count(*)::int n from public.workspace_properties'))[0].n, await rows()];
  await assert.rejects(rawJourney(ADMIN, { action: 'createEnquiry', name: 'Bad start', address: '9 Bad Start Road, Glasgow', propertyType: 'Flat', bedrooms: 1, bathrooms: 1, enquiry: { contactName: 'Bad Start', phone: '07700 900333' }, startWhen: 'Tomorrow' }), /Choose when they would like to get started/);
  assert.equal((await sql('select count(*)::int n from public.workspace_properties'))[0].n, props);
  assert.equal(await rows(), before);
});

test('a retry of the same request records nothing more; an owner or a cleaner records no team enquiry', async () => {
  const body = { requestId: crypto.randomUUID(), action: 'createEnquiry', name: 'Retry flat', address: '3 Retry Lane, Glasgow G2 2AA', propertyType: 'Flat', bedrooms: 1, bathrooms: 1, enquiry: { contactName: 'Rae Try', email: 'rae@example.com' } };
  await as(ADMIN); const first = await rpc('workspace_journey_action', [body]);
  const before = await rows();
  await as(ADMIN); assert.deepEqual(await rpc('workspace_journey_action', [body]), first);
  assert.equal(await rows(), before);
  assert.equal((await sql("select count(*)::int n from private.workspace_client_enquiries where property_id=$1 and source='team'", [first.propertyId]))[0].n, 1);
  // An owner's own enquiry is theirs (20261022300000), never the team's; a cleaner cannot add one.
  const own = await rawJourney(OWNER, { action: 'createEnquiry', name: 'Own flat', address: '4 Own Road, Leith EH6 4AA', propertyType: 'Flat', bedrooms: 1, bathrooms: 1 });
  assert.equal((await enquiryOf(own.propertyId)).source, 'owner_app');
  await assert.rejects(rawJourney(CLEANER, { action: 'createEnquiry', name: 'No', address: '5 No Road, Glasgow', propertyType: 'Flat', bedrooms: 1, bathrooms: 1, enquiry: { contactName: 'No One', phone: '07700 900444' } }), /Onboarding access denied/);
});

test('duplicates work as on the form: the same address first, else an open form answer with their email; the admins are told', async () => {
  const first = await teamEnquiry(ADMIN);
  const [p] = await sql('select address from public.workspace_properties where id=$1', [first.propertyId]);
  const [admins, supers, stays] = [await notified(ADMIN, 'enquiry.duplicate'), await notified(SUPER, 'enquiry.duplicate'), await notified(STAYS, 'enquiry.duplicate')];
  const again = await enquiryOf((await teamEnquiry(STAYS, { address: p.address, email: 'someone.else@example.com' })).propertyId);
  assert.deepEqual([again.duplicateReason, again.duplicateOf], ['same_address', first.propertyId]);
  assert.equal(await notified(ADMIN, 'enquiry.duplicate'), admins + 1, 'the admins are told, as for the form');
  assert.equal(await notified(SUPER, 'enquiry.duplicate'), supers + 1);
  assert.equal(await notified(STAYS, 'enquiry.duplicate'), stays, 'as for the form, only the admins');

  // The same person answered the public form too.
  const t = 'team-form-token';
  await as(ADMIN);
  const sent = await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Dana Form', email: 'dana@example.com', subject: 'Your free estimate', body: 'Hello {form link}', delivery: 'link' }), tokenHash: hash(t) }]);
  await asServer();
  const answers = enquiryAnswersSchema.parse({ fullName: 'Dana Form', email: 'dana@example.com', phone: '07700 900222', propertyAddress: '77 Form Street, Glasgow G3 3AA', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1, parking: 'None', garden: 'None', shortLet: 'no', furnishQuote: 'no', compliance: 'no', startWhen: 'Within a month', enquiryType: "I'd like a free performance estimate" });
  assert.deepEqual(await rpc('workspace_enquiry_public', [{ action: 'submit', tokenHash: hash(t), answers }]), { state: 'answered' });
  const before = await notified(ADMIN, 'enquiry.duplicate');
  const contact = await enquiryOf((await teamEnquiry(ADMIN, { contactName: 'Dana Form', email: 'Dana@Example.com' })).propertyId);
  const [formRow] = await sql('select property_id from private.workspace_client_enquiries where id=$1', [sent.id]);
  assert.deepEqual([contact.duplicateReason, contact.duplicateOf], ['same_contact', formRow.property_id], 'pointing at the property from the form');
  assert.equal(await notified(ADMIN, 'enquiry.duplicate'), before + 1);
  // Nothing in common: no flag, no notice.
  const fresh = await enquiryOf((await teamEnquiry(ADMIN)).propertyId);
  assert.equal(fresh.duplicateReason, null);
  assert.equal(await notified(ADMIN, 'enquiry.duplicate'), before + 1);
});

test('valuing an older answered form with no property makes one, and no second enquiry', async () => {
  const [e] = await sql(`insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,email_status,status,answers,sent_by,opened_at,submitted_at)
    values($1,'Old Form','old@example.com','s','b','link','manual','received',$2,$3,now(),now()) returning id,version`,
    [hash('older-form'), JSON.stringify({ fullName: 'Old Form', email: 'old@example.com', propertyAddress: '6 Old Road, Perth PH1 6AA', propertyType: 'House', bedrooms: 3, bathrooms: 1 }), users[ADMIN]]);
  const before = await rows();
  const listed = (await read()).items.find(x => x.id === e.id);
  const valued = await act(STAYS, { action: 'startValuing', enquiryId: e.id, version: e.version, ...valuationDraft(listed.answers) });
  assert.equal(valued.status, 'valuing'); assert.ok(valued.propertyId);
  assert.equal(await rows(), before, 'the form is the enquiry; no team row for it');
  assert.equal((await sql('select count(*)::int n from private.workspace_client_enquiries where property_id=$1', [valued.propertyId]))[0].n, 1);
});

test('valued, estimated and proceeded from the estimate page, where the owner account is made', async () => {
  const j = await teamEnquiry(ADMIN, { contactName: 'Lena New', email: 'lena.new@example.com', startWhen: 'Within a month' });
  const e = await enquiryOf(j.propertyId);
  const valued = await act(STAYS, { action: 'startValuing', enquiryId: e.id, version: e.version, ...valuationDraft(e.answers) });
  assert.equal(valued.status, 'valuing');
  assert.equal(valued.propertyId, j.propertyId, 'the same property, nothing new made');
  let now = await journey(STAYS, { action: 'publishEstimate', propertyId: j.propertyId, version: await version(j.propertyId), lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });
  assert.equal(now.stage, 'estimate');
  assert.equal(enquiryStep(await enquiryOf(j.propertyId)), 'estimate_ready', 'Client enquiries follows it on');
  // The estimate goes to the contact's email; they choose Proceed on the private page.
  const tokenHash = hash('team-proceed-token');
  await as(ADMIN);
  const link = (await db.query('select public.workspace_estimate_link_action($1::jsonb) r', [JSON.stringify({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash, delivery: 'email' })])).rows[0].r;
  assert.equal(link.to, 'lena.new@example.com');
  await asServer();
  assert.equal((await rpc('workspace_estimate_public', [{ action: 'decide', tokenHash, decision: 'proceed', feedback: '' }])).state, 'proceeding');
  // The server makes and links the owner's account (lib/owner-account-server.ts).
  await asServer();
  const ready = await rpc('workspace_owner_account', [{ action: 'prepare', tokenHash }]);
  assert.deepEqual([ready.state, ready.email, ready.name, ready.userId], ['ready', 'lena.new@example.com', 'Lena New', null]);
  const id = crypto.randomUUID();
  await sql('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now())', [id, 'lena.new@example.com', JSON.stringify({ full_name: '' })]);
  await asServer();
  assert.equal((await rpc('workspace_owner_account', [{ action: 'link', tokenHash, userId: id, created: true }])).send, true, 'the welcome email is due');
  const [after] = await sql('select client_id,stage from private.workspace_journeys where property_id=$1', [j.propertyId]);
  assert.deepEqual([after.client_id, after.stage], [id, 'agreement']);
  const [profile] = await sql('select role,status,full_name from public.workspace_profiles where user_id=$1', [id]);
  assert.deepEqual([profile.role, profile.status, profile.full_name], ['client', 'active', 'Lena New']);
  const shown = await enquiryOf(j.propertyId);
  assert.deepEqual([shown.source, enquiryStep(shown)], ['team', 'won'], 'Onboarding, still marked as the team\'s');
});

test("an existing owner's enquiry added by the team is valued and proceeded in their app", async () => {
  const j = await journey(ADMIN, { action: 'createEnquiry', clientId: users[OWNER], name: 'Owner third flat', address: '14 Owner Street, Edinburgh EH3 1AB', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, startWhen: 'As soon as possible' });
  const e = await enquiryOf(j.propertyId);
  assert.ok(isPriority(e, enquiryStep(e)));
  await act(ADMIN, { action: 'startValuing', enquiryId: e.id, version: e.version, ...valuationDraft(e.answers) });
  let now = await journey(STAYS, { action: 'publishEstimate', propertyId: j.propertyId, version: await version(j.propertyId), lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });
  assert.equal(enquiryStep(await enquiryOf(j.propertyId)), 'estimate', 'in their app, no email to send');
  now = await journey(OWNER, { action: 'decideEstimate', propertyId: j.propertyId, version: now.version, decision: 'proceed' });
  assert.deepEqual([now.stage, now.clientId], ['agreement', users[OWNER]]);
  assert.equal(enquiryStep(await enquiryOf(j.propertyId)), 'won');
});

test('closing a team enquiry archives its property, as for a form', async () => {
  const j = await teamEnquiry(ADMIN);
  const e = await enquiryOf(j.propertyId);
  const closed = await act(ADMIN, { action: 'closeEnquiry', enquiryId: e.id, version: e.version, note: 'Called back: not going ahead' });
  assert.equal(closed.status, 'closed');
  assert.equal((await sql('select status from public.workspace_properties where id=$1', [j.propertyId]))[0].status, 'archived');
});
