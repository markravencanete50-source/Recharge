import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Every new enquiry in Properties straight away (migration 20261015200000): a landlord's submit makes the
// property, its onboarding journey and work item in the same transaction, with no owner. Duplicates are
// flagged, not merged; Start valuing reuses the property; closing archives it; owners, cleaners, Ready and
// Accounts never see it while it is a new enquiry.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, valuationDraft, enquiryStep } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const MIGRATION = '20261015200000_enquiry_property_on_submit.sql';
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'stays', 'cleans', 'client', 'accounts', 'ready', 'cleaning_manager'];
const users = roles.map((_, i) => `97710000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, STAYS_NO_TOOL, CLEANER, OWNER, ACCOUNTS, READY, MANAGER] = roles.map((_, i) => i);
const session = i => users[i].replace('9771', '9871');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ep${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Callum', 'Isla', 'Owner', 'Graham', 'Ross', 'Kirsty'][i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[STAYS]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asServer() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = async () => clientEnquiriesSchema.parse(await rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null]));
const hash = token => createHash('sha256').update(token).digest('hex');
const token = () => createHash('sha256').update(crypto.randomUUID()).digest('hex');
const pub = input => rpc('workspace_enquiry_public', [input]);
const ANSWERS = enquiryAnswersSchema.parse({
  fullName: 'Alex Morgan', companyName: 'Morgan Lets Ltd', email: 'alex@example.com', phone: '07700 900123',
  propertyAddress: '12 Shore Road, Leith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1, parking: 'Free on-street', garden: 'Shared', mediaLink: 'https://photos.example.com/album',
  shortLet: 'no', furnishQuote: 'yes', compliance: 'yes', startWhen: 'Within a month', notes: 'Call me after 6pm on 07700 900999', enquiryType: "I'd like a free performance estimate",
});
// The team sends a form (as `sender`), the landlord answers it through the site's server. Each landlord has their own
// email and phone, so only the address can make a duplicate here (the contact check: enquiry-duplicates-database).
let landlords = 0;
async function answered(sender = ADMIN, extra = {}) {
  const t = token(), n = ++landlords, contact = { email: `alex${n}@example.com`, phone: `07700 9${String(n).padStart(5, '0')}` };
  await as(sender);
  const input = teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Alex Morgan', email: contact.email, subject: 'Your free estimate', body: 'Hello {form link}', delivery: 'link' });
  const sent = await rpc('workspace_teams_action', [{ ...input, tokenHash: hash(t) }]);
  await asServer();
  assert.deepEqual(await pub({ action: 'submit', tokenHash: hash(t), answers: { ...ANSWERS, ...contact, ...extra } }), { state: 'answered' });
  const [row] = await owner('select * from private.workspace_client_enquiries where id=$1', [sent.id]);
  return { t, sent, row };
}
const sees = async (i, propertyId) => { await as(i); return (await db.query('select id from public.workspace_properties where id=$1', [propertyId])).rows.length === 1; };
after(async () => { await db.close(); await vite.close(); });

test('a submitted form puts the property in Properties at once, with no owner and no contact details', async () => {
  const { sent, row } = await answered(ADMIN);
  assert.equal(row.status, 'received', 'the enquiry still waits to be valued');
  assert.ok(row.property_id, 'and already has its property');
  const [p] = await owner('select * from public.workspace_properties where id=$1', [row.property_id]);
  assert.deepEqual([p.name, p.address, p.region, p.status, p.bedrooms, p.created_by], ['12 Shore Road', ANSWERS.propertyAddress, 'Edinburgh', 'onboarding', 2, users[ADMIN]]);
  const [j] = await owner('select * from private.workspace_journeys where property_id=$1', [row.property_id]);
  assert.deepEqual([j.stage, j.client_id, j.property_type, j.bathrooms], ['enquiry', null, 'Flat', 1]);
  assert.deepEqual(j.enquiry, { wcs: 1, parking: 'Free on-street', garden: 'Shared', photoLink: 'https://photos.example.com/album' });
  for (const secret of ['Alex', 'alex', '@example.com', '07700', 'Morgan Lets', '6pm']) assert.ok(!JSON.stringify({ p, j }).includes(secret), secret + ' stays on the enquiry');
  const [w] = await owner('select * from public.workspace_work_items where id=$1', [j.work_id]);
  assert.deepEqual([w.module_id, w.title, w.created_by, w.status], ['property-onboarding', 'Property onboarding', users[ADMIN], 'waiting']);
  const assigned = await owner('select user_id,assignment,granted_by from public.workspace_property_assignments where property_id=$1 order by user_id', [row.property_id]);
  assert.deepEqual(assigned, [{ user_id: users[STAYS], assignment: 'staff', granted_by: users[ADMIN] }], 'the onboarding team, granted by the sender; no owner');
  // The team's list shows the property on the enquiry, and the step is still "ready to value".
  await as(STAYS);
  const back = (await read()).items.find(e => e.id === sent.id);
  assert.deepEqual([back.propertyId, back.propertyName, back.stage, enquiryStep(back), back.duplicateReason], [row.property_id, '12 Shore Road', 'enquiry', 'received', null]);
});

test('the property name follows the app\'s rule for every address shape', async () => {
  for (const address of ['12 Shore Road, Leith, Edinburgh EH6 6RG', '3F2, 17 Warrender Park Road, Edinburgh EH9 1EU', 'Flat 1\n22 High Street\nDunbar EH42 1EN', 'Rose Cottage, Kelso TD5 7AA', '9', ' , Old Mill, Peebles']) {
    const [{ name }] = await owner('select private.workspace_enquiry_property_name($1) as name', [address]);
    const app = valuationDraft({ ...ANSWERS, propertyAddress: address }).name;
    assert.equal(name, app.trim().length >= 2 ? app : 'New enquiry', address);
  }
});

test('owners, cleaners, Ready, Accounts and Guest relations without onboarding never see a new enquiry', async () => {
  const { row } = await answered(ADMIN);
  const expected = { [SUPER]: true, [ADMIN]: true, [STAYS]: true, [STAYS_NO_TOOL]: false, [CLEANER]: false, [OWNER]: false, [ACCOUNTS]: false, [READY]: false, [MANAGER]: false };
  for (const [i, visible] of Object.entries(expected)) assert.equal(await sees(Number(i), row.property_id), visible, roles[i]);
  // Nor through the property functions: Accounts' finance access skips a property still at the enquiry stage.
  await as(ACCOUNTS); await db.exec('reset role');
  assert.equal((await db.query("select private.workspace_can_property($1,'owner-statements') ok", [row.property_id])).rows[0].ok, false);
  // Once it is valued and moves on, Accounts see it as before.
  await owner("update private.workspace_journeys set stage='estimate' where property_id=$1", [row.property_id]);
  assert.equal(await sees(ACCOUNTS, row.property_id), true, 'accounts, after the estimate');
  assert.equal(await sees(OWNER, row.property_id), false, 'still no owner');
});

test('a link works once and expires after 30 days; the property is made once', async () => {
  const { t, row } = await answered(ADMIN);
  await asServer();
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers: ANSWERS }), /already been sent/);
  assert.equal((await owner("select count(*)::int n from public.workspace_properties where created_by=$1 and request_id=md5($2||':enquiry-property')::uuid", [users[ADMIN], row.id]))[0].n, 1);
  const late = token();
  await as(ADMIN);
  const sent = await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Late', email: 'late@example.com', subject: 'Estimate', body: 'Hi', delivery: 'link' }), tokenHash: hash(late) }]);
  await owner("update private.workspace_client_enquiries set expires_at=now()-interval '1 day' where id=$1", [sent.id]);
  await asServer();
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(late), answers: ANSWERS }), /expired/);
  assert.equal((await owner('select property_id from private.workspace_client_enquiries where id=$1', [sent.id]))[0].property_id, null, 'no property from an expired link');
});

test('duplicates are flagged, not merged', async () => {
  // A property already in use at the same address, written differently.
  const [{ id: existing }] = await owner("insert into public.workspace_properties(name,address,created_by,request_id,status) values('Cramond flat','7 cramond glebe  ROAD edinburgh eh46ns, UK',$1,gen_random_uuid(),'active') returning id", [users[ADMIN]]);
  const same = await answered(ADMIN, { propertyAddress: '7 Cramond Glebe Road, Edinburgh EH4 6NS' });
  assert.deepEqual([same.row.duplicate_of, same.row.duplicate_reason], [existing, 'same_address']);
  assert.notEqual(same.row.property_id, existing, 'a property of its own all the same');
  await as(ADMIN);
  const view = (await read()).items.find(e => e.id === same.sent.id);
  assert.deepEqual([view.duplicateOf, view.duplicateOfName, view.duplicateReason], [existing, 'Cramond flat', 'same_address']);
  // "Are you an existing client?" is no longer asked (20261020800000); a form sent with it all the same flags nothing.
  const told = await answered(ADMIN, { propertyAddress: '8 Harbour Lane, Oban PA34 5AA', existingClient: 'yes' });
  assert.deepEqual([told.row.duplicate_of, told.row.duplicate_reason], [null, '']);
  // An archived property at that address is not a duplicate.
  await owner("update public.workspace_properties set status='archived' where id=$1", [existing]);
  const [{ id: other }] = await owner('select property_id as id from private.workspace_client_enquiries where id=$1', [same.sent.id]);
  await owner("update private.workspace_journeys set stage='archived' where property_id=$1", [other]);
  await owner("update public.workspace_properties set status='archived' where id=$1", [other]);
  const again = await answered(ADMIN, { propertyAddress: '7 Cramond Glebe Road, Edinburgh EH4 6NS' });
  assert.deepEqual([again.row.duplicate_of, again.row.duplicate_reason], [null, ''], 'only properties still in use count');
});

test('Start valuing reuses the property and saves the team\'s corrections onto it', async () => {
  const { sent, row } = await answered(ADMIN);
  await as(STAYS);
  const back = (await read()).items.find(e => e.id === sent.id);
  const draft = valuationDraft(back.answers);
  const valued = await act({ action: 'startValuing', enquiryId: sent.id, version: back.version, ...draft, name: 'Shore Road, top floor', region: '', bedrooms: 3 });
  assert.deepEqual([valued.status, valued.propertyId, valued.propertyName, enquiryStep(valued)], ['valuing', row.property_id, 'Shore Road, top floor', 'valuing']);
  const [p] = await owner('select name,region,bedrooms from public.workspace_properties where id=$1', [row.property_id]);
  assert.deepEqual(p, { name: 'Shore Road, top floor', region: 'Edinburgh', bedrooms: 3 }, 'a blank area is worked out from the address');
  const [j] = await owner('select enquiry from private.workspace_journeys where property_id=$1', [row.property_id]);
  assert.equal(j.enquiry.contactName, 'Alex Morgan', 'what the team chose to keep, as before');
  assert.equal((await owner('select count(*)::int n from private.workspace_client_enquiries where id=$1 and property_id=$2', [sent.id, row.property_id]))[0].n, 1, 'no second property');
  await assert.rejects(act({ action: 'startValuing', enquiryId: sent.id, version: valued.version, ...draft }), /Only an answered enquiry/);
});

test('an enquiry answered before this change still makes its property when valued', async () => {
  const t = token();
  await as(ADMIN);
  const sent = await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Old', email: 'old@example.com', subject: 'Estimate', body: 'Hi', delivery: 'link' }), tokenHash: hash(t) }]);
  await owner("update private.workspace_client_enquiries set status='received',answers=$2,submitted_at=now() where id=$1", [sent.id, JSON.stringify({ ...ANSWERS, propertyAddress: '5 Mill Lane, Hawick TD9 9AA' })]);
  await as(ADMIN);
  const back = (await read()).items.find(e => e.id === sent.id);
  assert.equal(back.propertyId, null);
  const valued = await act({ action: 'startValuing', enquiryId: sent.id, version: back.version, ...valuationDraft(back.answers) });
  assert.equal(valued.status, 'valuing');
  assert.ok(valued.propertyId);
});

test('closing a new enquiry archives its property; one that has moved on is left alone', async () => {
  const { sent, row } = await answered(ADMIN);
  const [j] = await owner('select work_id from private.workspace_journeys where property_id=$1', [row.property_id]);
  await as(ADMIN);
  const closed = await act({ action: 'closeEnquiry', enquiryId: sent.id, version: (await read()).items.find(e => e.id === sent.id).version, note: 'Same place as another enquiry' });
  assert.equal(closed.status, 'closed');
  const [after] = await owner('select p.status,j.stage,w.status as work from public.workspace_properties p join private.workspace_journeys j on j.property_id=p.id join public.workspace_work_items w on w.id=$2 where p.id=$1', [row.property_id, j.work_id]);
  assert.deepEqual(after, { status: 'archived', stage: 'archived', work: 'declined' }, 'archived, nothing deleted');
  // The onboarding guard still refuses any other change to a journey's work item.
  const other = await answered(ADMIN);
  const [{ work_id: otherWork }] = await owner('select work_id from private.workspace_journeys where property_id=$1', [other.row.property_id]);
  for (const status of ['cancelled', 'completed', 'declined']) await assert.rejects(owner('update public.workspace_work_items set status=$2 where id=$1', [otherWork, status]), /Use the property onboarding journey/, status);
  // An estimate already published from the property: closing the enquiry keeps the property going.
  const moved = await answered(ADMIN);
  await owner("update private.workspace_journeys set stage='estimate' where property_id=$1", [moved.row.property_id]);
  await as(ADMIN);
  const view = (await read()).items.find(e => e.id === moved.sent.id);
  assert.equal(enquiryStep(view), 'estimate', 'the enquiry follows its property');
  await act({ action: 'closeEnquiry', enquiryId: moved.sent.id, version: view.version, note: 'Tidying the list' });
  assert.equal((await owner('select status from public.workspace_properties where id=$1', [moved.row.property_id]))[0].status, 'onboarding');
});

test('the team can still add an enquiry by hand, and the migration runs twice without change', async () => {
  const patched = ['private.workspace_enquiry_public(jsonb)', 'private.workspace_client_enquiry_action(jsonb)', 'private.workspace_client_enquiry_view(private.workspace_client_enquiries)', 'private.workspace_assign_onboarding_team()'];
  const defs = async () => Promise.all(patched.map(async f => (await owner('select pg_get_functiondef($1::regprocedure) d', [f]))[0].d));
  const before = await defs();
  await db.exec('reset role');
  await db.exec(await fs.readFile('supabase/migrations/' + MIGRATION, 'utf8'));
  assert.deepEqual(await defs(), before);
  assert.equal((await owner("select count(*)::int n from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and pg_get_constraintdef(oid) like '%property_id IS NOT NULL%'"))[0].n, 1);
  const { row } = await answered(ADMIN);
  assert.ok(row.property_id, 'still one property per submit after a second run');
  // The onboarding team trigger still grants as the signed-in person for an enquiry added by hand.
  await as(ADMIN);
  const made = (await db.query('select public.workspace_journey_action($1::jsonb) result', [JSON.stringify({ action: 'createEnquiry', requestId: crypto.randomUUID(), name: 'Harbour cottage', address: '2 Harbour Road, Oban PA34 4LW', propertyType: 'Cottage', bedrooms: 2, bathrooms: 1, enquiry: { contactName: 'Jo Smith', phone: '07700 900321' } })])).rows[0].result;
  assert.deepEqual(await owner('select user_id,granted_by from public.workspace_property_assignments where property_id=$1', [made.propertyId]), [{ user_id: users[STAYS], granted_by: users[ADMIN] }]);
});
