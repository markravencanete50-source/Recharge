import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Alex's onboarding framework, the client side (migration 20261025200000): the open enquiry form (a form of its own per
// browser, "How did you hear about us?", hidden from the team until it comes back), the owner account linked by the
// enquiry's verified email at sign-in, a reason required to decline, the owner's Welcome and Process ticks, and the
// onboarding videos only a super admin may set.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { formAnswersSchema, clientEnquiriesSchema } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { clientOnboardingActionSchema, clientOnboardingSchema, ownerChecklist } = await vite.ssrLoadModule('/lib/client-onboarding.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const MINE = '20261025200000_client_onboarding_framework.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(migrations.includes(MINE));
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_enquiry_public(jsonb)', 'private.workspace_enquiry_public_start(jsonb)', 'private.workspace_client_enquiries_read()', 'private.workspace_journey_action(jsonb)',
  'private.workspace_estimate_public(jsonb)', 'private.workspace_enquiry_owner_claim()', 'private.workspace_client_onboarding_read(uuid)', 'private.workspace_client_onboarding_action(jsonb)'];
const definitions = async () => [
  ...await Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d)),
  (await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conname='workspace_client_enquiries_source'")).rows[0].d,
  (await db.query("select count(*)::int n from pg_constraint where conrelid in ('private.workspace_onboarding_seen'::regclass,'private.workspace_onboarding_videos'::regclass)")).rows[0].n,
];
const firstRun = await definitions();
await db.exec(await fs.readFile('supabase/migrations/' + MINE, 'utf8'));
const secondRun = await definitions();

const roles = ['super_admin', 'admin', 'stays', 'client', 'client', 'cleans'];
const users = roles.map((_, i) => `98810000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER_OWNER, CLEANER] = roles.map((_, i) => i);
const session = id => id.replace('9881', '9981');
async function person(id, email, role, status, name = '') {
  await db.exec('reset role');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, email]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(id), id]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(id), id]);
  await db.query('update public.workspace_profiles set status=$3,role=$2,full_name=$4 where user_id=$1', [id, role, status, name]);
}
for (let i = 0; i < users.length; i++) {
  await person(users[i], `co${i}@example.com`, roles[i], 'active', ['Sam', 'Morag', 'Fiona', 'Jamie Owner', 'Other Owner', 'Isla'][i]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
  for (const m of ['property-onboarding', 'client-dashboard']) await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [users[i], m]);
}
async function asId(id) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session(id) })]);
  await db.exec('set role authenticated');
}
const as = i => asId(users[i]);
async function asServer() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const journey = async (i, input) => { await as(i); return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]); };
const rawJourney = async (i, input) => { await as(i); return rpc('workspace_journey_action', [{ requestId: crypto.randomUUID(), ...input }]); };
const publicForm = async input => { await asServer(); return rpc('workspace_enquiry_public', [input]); };
const claim = async id => { await asId(id); return rpc('workspace_enquiry_owner_claim'); };
const onboarding = async (i, input) => { await as(i); return rpc('workspace_client_onboarding_action', [clientOnboardingActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]); };
const rawOnboarding = async (i, input) => { await as(i); return rpc('workspace_client_onboarding_action', [input]); };
const readOnboarding = async (i, target = null) => { await as(i); return clientOnboardingSchema.parse(await rpc('workspace_client_onboarding_read', [target])); };
const enquiries = async () => { await as(ADMIN); return clientEnquiriesSchema.parse(await rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null])).items; };
const notified = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const hash = n => n.toString(16).padStart(64, '0');
const version = async propertyId => (await sql('select version from private.workspace_journeys where property_id=$1', [propertyId]))[0].version;
const publish = async propertyId => journey(STAYS, { action: 'publishEstimate', propertyId, version: await version(propertyId), lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });
after(async () => { await db.close(); await vite.close(); });

let streets = 0;
const answers = (over = {}) => formAnswersSchema.parse({ fullName: 'Rona Website', email: 'rona@example.com', propertyAddress: `${++streets} Web Street, Edinburgh EH1 ${streets}AB`, propertyType: 'Flat',
  bedrooms: 2, wcs: 1, bathrooms: 1, enquiryType: "I'd like a free performance estimate", heardFrom: 'Referral from a friend or client', referral: 'Moira Smith', ...over });
// A landlord on the open form: a form of its own, then the answers.
async function websiteEnquiry(n, over = {}) {
  assert.equal((await publicForm({ action: 'start', tokenHash: hash(n) })).state, 'open');
  assert.deepEqual(await publicForm({ action: 'submit', tokenHash: hash(n), answers: answers(over) }), { state: 'answered' });
  return (await sql('select * from private.workspace_client_enquiries where token_hash=$1', [hash(n)]))[0];
}

test('the migration runs twice without changing anything', () => {
  assert.deepEqual(secondRun, firstRun);
  assert.match(firstRun.at(-2), /'public'/);
  for (const d of firstRun.slice(0, -1)) assert.ok(!String(d).includes('—'), 'no em dash');
});

test('who may call what: the claim, the checklist and the videos are for people signed in; the form start is internal', async () => {
  const can = async (role, fn) => (await sql("select has_function_privilege($1,$2,'execute') ok", [role, fn]))[0].ok;
  for (const fn of ['public.workspace_enquiry_owner_claim()', 'public.workspace_client_onboarding_read(uuid)', 'public.workspace_client_onboarding_action(jsonb)']) {
    assert.equal(await can('anon', fn), false, fn); assert.equal(await can('authenticated', fn), true, fn);
  }
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await can(role, 'private.workspace_enquiry_public_start(jsonb)'), false, role);
  assert.equal(await can('service_role', 'public.workspace_enquiry_public(jsonb)'), true, 'the site\'s server still opens forms');
});

test('the open form: a form of its own, the new answers, the contact from the answers, and hidden from the team until it comes back', async () => {
  assert.equal((await publicForm({ action: 'start', tokenHash: hash(1) })).state, 'open');
  const again = await publicForm({ action: 'start', tokenHash: hash(1) });
  assert.equal(again.state, 'open', 'the same token is the same form');
  assert.equal((await sql('select count(*)::int n from private.workspace_client_enquiries where token_hash=$1', [hash(1)]))[0].n, 1);
  const [draft] = await sql('select * from private.workspace_client_enquiries where token_hash=$1', [hash(1)]);
  assert.equal(draft.source, 'public'); assert.equal(draft.sent_by, users[SUPER], 'the first super admin stands in as the sender');
  assert.ok(!(await enquiries()).some(e => e.id === draft.id), 'an unanswered website form is not in Client enquiries');
  // A team link's token cannot be taken over by "start".
  await as(ADMIN);
  await rpc('workspace_teams_action', [{ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Linked Person', email: 'linked@example.com', subject: 'Your estimate', body: 'Hello', delivery: 'link', tokenHash: hash(2) }]);
  await assert.rejects(publicForm({ action: 'start', tokenHash: hash(2) }), /This link is not valid/);
  // No phone and no services answers; "How did you hear about us?" must be one of the choices.
  await assert.rejects(publicForm({ action: 'submit', tokenHash: hash(1), answers: { ...answers(), heardFrom: 'A billboard' } }), /Check your answers/);
  assert.deepEqual(await publicForm({ action: 'submit', tokenHash: hash(1), answers: answers() }), { state: 'answered' });
  const e = (await enquiries()).find(x => x.id === draft.id);
  assert.equal(e.source, 'public'); assert.equal(e.status, 'received');
  assert.equal(e.recipientName, 'Rona Website'); assert.equal(e.recipientEmail, 'rona@example.com', 'their answers name the contact');
  assert.equal(e.answers.heardFrom, 'Referral from a friend or client'); assert.equal(e.answers.referral, 'Moira Smith'); assert.equal(e.answers.phone, undefined);
  assert.ok(e.propertyId, 'the property is made as for any returned form');
  // The team's link still works and still needs the email and the address.
  await assert.rejects(publicForm({ action: 'submit', tokenHash: hash(2), answers: { ...answers(), email: '' } }), /Answer every question/);
  assert.deepEqual(await publicForm({ action: 'submit', tokenHash: hash(2), answers: answers({ email: 'linked@example.com' }) }), { state: 'answered' });
});

test('signing up with the enquiry email puts the property on the new owner account; nothing else is linked', async () => {
  const e = await websiteEnquiry(10, { email: 'New.Owner@Example.com' });
  const fresh = '98810000-0000-4000-8000-000000000101';
  await person(fresh, 'new.owner@example.com', 'client', 'pending');
  const admins = await notified(ADMIN, 'enquiry.owner_linked');
  const result = await claim(fresh);
  assert.equal(result.linked, 1); assert.deepEqual(result.propertyIds, [e.property_id]);
  const [profile] = await sql('select status,full_name from public.workspace_profiles where user_id=$1', [fresh]);
  assert.equal(profile.status, 'active'); assert.equal(profile.full_name, 'Rona Website', 'their name from the form');
  const [j] = await sql('select client_id,stage from private.workspace_journeys where property_id=$1', [e.property_id]);
  assert.equal(j.client_id, fresh);
  assert.equal((await sql("select count(*)::int n from public.workspace_property_assignments where property_id=$1 and user_id=$2 and assignment='client'", [e.property_id, fresh]))[0].n, 1);
  assert.ok((await sql('select module_id from public.workspace_module_grants where user_id=$1', [fresh])).some(g => g.module_id === 'property-onboarding'), 'the usual owner tools');
  assert.equal(await notified(ADMIN, 'enquiry.owner_linked'), admins + 1, 'the admins hear it');
  assert.equal(await notified(SUPER, 'enquiry.owner_linked') > 0, true, 'and the enquiry\'s sender');
  assert.ok(noticeCopy('enquiry.owner_linked').title.length > 0);
  // They now see it as theirs.
  await asId(fresh);
  assert.equal((await rpc('workspace_client_onboarding_read', [e.property_id])).answers.email, 'New.Owner@Example.com');
  // Signing in again links nothing new.
  assert.equal((await claim(fresh)).linked, 0);
  // A team member with an enquiry's email is never linked, and an unverified email links nothing.
  const t = await websiteEnquiry(11, { email: 'co2@example.com' });
  assert.equal((await claim(users[STAYS])).linked, 0);
  assert.equal((await sql('select client_id from private.workspace_journeys where property_id=$1', [t.property_id]))[0].client_id, null);
  const u = await websiteEnquiry(12, { email: 'unverified@example.com' });
  const unverified = '98810000-0000-4000-8000-000000000102';
  await person(unverified, 'unverified@example.com', 'client', 'pending');
  await sql('update auth.users set email_confirmed_at=null where id=$1', [unverified]);
  await assert.rejects(claim(unverified), /Verified sign-in required/);
  assert.equal((await sql('select client_id from private.workspace_journeys where property_id=$1', [u.property_id]))[0].client_id, null);
});

test('a property past the estimate, or switched-off owner accounts, is not linked', async () => {
  const e = await websiteEnquiry(20, { email: 'late@example.com' });
  await publish(e.property_id);
  await rawJourney(ADMIN, { action: 'decideEstimate', propertyId: e.property_id, version: await version(e.property_id), decision: 'proceed' });
  const late = '98810000-0000-4000-8000-000000000201';
  await person(late, 'late@example.com', 'client', 'pending');
  assert.equal((await claim(late)).linked, 0, 'after Proceed the owner account comes from Proceed');
  const b = await websiteEnquiry(21, { email: 'beta@example.com' });
  const beta = '98810000-0000-4000-8000-000000000202';
  await person(beta, 'beta@example.com', 'client', 'pending');
  await sql('update private.workspace_beta_mode set team_only=true');
  const r = await claim(beta);
  await sql('update private.workspace_beta_mode set team_only=false');
  assert.equal(r.linked, 0); assert.equal(r.reason, 'owner_accounts_off');
  assert.equal((await sql('select status from public.workspace_profiles where user_id=$1', [beta]))[0].status, 'pending');
  assert.equal((await sql('select client_id from private.workspace_journeys where property_id=$1', [b.property_id]))[0].client_id, null);
});

test('not proceeding needs a reason, in the app and on the estimate page', async () => {
  const j = await journey(OWNER, { action: 'createEnquiry', name: 'Decline flat', address: '7 Decline Road, Perth PH1 1AA', propertyType: 'Flat', bedrooms: 1, bathrooms: 1 });
  await publish(j.propertyId);
  await assert.rejects(rawJourney(OWNER, { action: 'decideEstimate', propertyId: j.propertyId, version: await version(j.propertyId), decision: 'decline', feedback: '  ' }), /Tell us why you are not going ahead/);
  assert.equal((await sql('select stage from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].stage, 'estimate', 'nothing changed');
  const done = await rawJourney(OWNER, { action: 'decideEstimate', propertyId: j.propertyId, version: await version(j.propertyId), decision: 'decline', feedback: 'The fees are too high for us.' });
  assert.equal(done.stage, 'archived'); assert.equal(done.feedback, 'The fees are too high for us.');
  // The estimate page (the private link, for estimates already emailed).
  await as(ADMIN);
  const k = await rpc('workspace_journey_action', [{ requestId: crypto.randomUUID(), action: 'createEnquiry', name: 'Link flat', address: '8 Link Road, Perth PH1 1AB', propertyType: 'Flat', bedrooms: 1, bathrooms: 1, enquiry: { contactName: 'Link Person', email: 'linkperson@example.com' } }]);
  await publish(k.propertyId);
  await as(ADMIN);
  await rpc('workspace_estimate_link_action', [{ action: 'issue', requestId: crypto.randomUUID(), propertyId: k.propertyId, tokenHash: hash(30), delivery: 'link' }]);
  await asServer();
  await assert.rejects(rpc('workspace_estimate_public', [{ action: 'decide', tokenHash: hash(30), decision: 'decline', feedback: '' }]), /Tell us why you are not going ahead/);
  assert.equal((await rpc('workspace_estimate_public', [{ action: 'decide', tokenHash: hash(30), decision: 'decline', feedback: 'We are selling instead.' }])).state, 'declined');
});

test("the owner's Welcome and Process ticks: theirs only, kept per property, with a receipt per request", async () => {
  const j = await journey(OWNER, { action: 'createEnquiry', name: 'Tick flat', address: '9 Tick Road, Perth PH1 1AC', propertyType: 'Flat', bedrooms: 1, bathrooms: 1 });
  let state = await readOnboarding(OWNER, j.propertyId);
  assert.deepEqual(state.seen, { welcome: null, process: null });
  assert.deepEqual(ownerChecklist({ stage: 'enquiry', estimate: null }, state.seen).map(s => s.mark), ['todo', 'todo', 'waiting']);
  const requestId = crypto.randomUUID();
  await as(OWNER);
  const first = await rpc('workspace_client_onboarding_action', [{ action: 'markSeen', requestId, propertyId: j.propertyId, step: 'welcome' }]);
  assert.ok(first.seen.welcome, 'Welcome is ticked');
  const replay = await rpc('workspace_client_onboarding_action', [{ action: 'markSeen', requestId, propertyId: j.propertyId, step: 'welcome' }]);
  assert.deepEqual(replay, first, 'a retry gives the first answer');
  await assert.rejects(rpc('workspace_client_onboarding_action', [{ action: 'markSeen', requestId, propertyId: j.propertyId, step: 'process' }]), /Request identifier reused/);
  state = clientOnboardingSchema.parse(await onboarding(OWNER, { action: 'markSeen', propertyId: j.propertyId, step: 'process' }));
  assert.ok(state.seen.process);
  assert.equal((await sql('select count(*)::int n from private.workspace_onboarding_seen where property_id=$1', [j.propertyId]))[0].n, 2);
  await publish(j.propertyId);
  const published = (await sql('select estimate from private.workspace_journeys where property_id=$1', [j.propertyId]))[0].estimate;
  assert.deepEqual(ownerChecklist({ stage: 'estimate', estimate: published }, state.seen).map(s => s.mark), ['done', 'done', 'arrived'], 'an amber tick once the estimate is there');
  // Someone else's property, the team, a bad step: refused.
  await assert.rejects(onboarding(OTHER_OWNER, { action: 'markSeen', propertyId: j.propertyId, step: 'welcome' }), /Only the owner/);
  await assert.rejects(readOnboarding(OTHER_OWNER, j.propertyId), /Onboarding access denied/);
  await assert.rejects(onboarding(ADMIN, { action: 'markSeen', propertyId: j.propertyId, step: 'welcome' }), /Only the owner/);
  await assert.rejects(rawOnboarding(OWNER, { action: 'markSeen', requestId: crypto.randomUUID(), propertyId: j.propertyId, step: 'estimate' }), /Choose the step/);
  await assert.rejects(rawOnboarding(OWNER, { action: 'markSeen', requestId: crypto.randomUUID(), propertyId: j.propertyId, step: 'welcome', extra: 1 }), /./);
  assert.equal((await readOnboarding(ADMIN, j.propertyId)).seen.welcome !== null, true, 'the team can read the ticks');
});

test('the onboarding videos: only a super admin sets them, only YouTube, Vimeo or Loom; everyone signed in reads them', async () => {
  const empty = await readOnboarding(OWNER);
  assert.deepEqual(empty.videos, { welcome: '', process: '', estimate: '' });
  assert.equal(empty.canEditVideos, false);
  const set = await onboarding(SUPER, { action: 'setVideo', step: 'welcome', url: 'https://www.loom.com/share/0123456789abcdef0123456789abcdef' });
  assert.equal(set.videos.welcome, 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'); assert.equal(set.canEditVideos, true);
  await onboarding(SUPER, { action: 'setVideo', step: 'estimate', url: 'https://youtu.be/dQw4w9WgXcQ' });
  for (const i of [ADMIN, STAYS]) await assert.rejects(onboarding(i, { action: 'setVideo', step: 'process', url: 'https://vimeo.com/123456789' }), /Only a super admin/);
  await assert.rejects(rawOnboarding(SUPER, { action: 'setVideo', requestId: crypto.randomUUID(), step: 'process', url: 'https://example.com/video.mp4' }), /YouTube, Vimeo or Loom/);
  assert.equal(clientOnboardingActionSchema.safeParse({ action: 'setVideo', requestId: crypto.randomUUID(), step: 'process', url: 'https://example.com/video.mp4' }).success, false, 'the app checks it first');
  const seen = await readOnboarding(CLEANER);
  assert.equal(seen.videos.welcome, set.videos.welcome, 'owners and the team can read them');
  assert.equal(seen.videos.estimate, 'https://youtu.be/dQw4w9WgXcQ');
  // An empty link takes the video away (the step shows its words only); the row stays.
  assert.equal((await onboarding(SUPER, { action: 'setVideo', step: 'welcome', url: '' })).videos.welcome, '');
  assert.equal((await sql('select count(*)::int n from private.workspace_onboarding_videos'))[0].n, 2);
});
