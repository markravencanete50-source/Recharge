import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The estimate, emailed with a private link (Lee, 14 October): the team publishes, the server makes a link per request
// (only its hash is kept), emails it or copies it; the client opens it without an account and decides, which moves the
// journey exactly as the team's decideEstimate does. "Estimate sent" only once the current estimate's email has gone.
const MINE = '20261019520000_estimate_email_link.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_journey_view(private.workspace_journeys)', 'private.workspace_client_enquiry_view(private.workspace_client_enquiries)', 'private.workspace_estimate_link_action(jsonb)', 'private.workspace_estimate_public(jsonb)'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
// Run again with the migrations after it (20261020880000 patches workspace_estimate_public), each safe to run twice.
for (const file of files.filter(f => f >= MINE)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const secondRun = await definitions();
after(() => db.close());

const users = ['32000000-0000-4000-8000-000000000001', '32000000-0000-4000-8000-000000000002', '32000000-0000-4000-8000-000000000003', '32000000-0000-4000-8000-000000000004'];
const roles = ['super_admin', 'stays', 'cleans', 'stays'];
const [ADMIN, STAYS, CLEANER, OTHER_STAYS] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  const id = users[i], session = id.replace('32000000', '42000000');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `estimate${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, id]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session, id]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [id, roles[i], 'Person ' + i]);
  if (i !== OTHER_STAYS) for (const m of ['property-onboarding', 'client-dashboard']) await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [id, m]);
}
async function as(i) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('32000000', '42000000') })]); await db.exec('set role authenticated'); }
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const journey = async input => (await db.query('select public.workspace_journey_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const link = async input => (await db.query('select public.workspace_estimate_link_action($1::jsonb) result', [JSON.stringify(input)])).rows[0].result;
const pub = async input => { await asBackend(); return (await db.query('select public.workspace_estimate_public($1::jsonb) result', [JSON.stringify(input)])).rows[0].result; };
const hash = n => n.toString(16).padStart(64, '0');
const enquiry = { action: 'createEnquiry', name: 'Holmhead flat', address: '2 Holmhead Place, Glasgow', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 };
const estimate = { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [{ name: 'Flat nearby', url: 'https://www.airbnb.co.uk/rooms/1', adrMinor: 10500 }], comments: 'Busy in August.' };
let j, phoneOnly;

test('the migration runs twice without change', () => { assert.deepEqual(secondRun, firstRun); assert.match(firstRun[0], /'estimateDelivery'/); assert.match(firstRun[1], /'estimateDelivery'/); });

test('before publishing nothing can be sent; the journey shows no delivery until there is an estimate', async () => {
  await as(ADMIN);
  j = await journey({ ...enquiry, enquiry: { contactName: 'Morag Example', email: 'Morag@Example.com' } });
  phoneOnly = await journey({ ...enquiry, name: 'Phone only flat', enquiry: { contactName: 'Ali Example', phone: '07700 900456' } });
  assert.equal(j.estimateDelivery, null);
  await assert.rejects(link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash: hash(1), delivery: 'email' }), /Only a published estimate/);
});

test('publishing then issuing: emailed once per request, "ready" until the email went, then "sent"', async () => {
  await as(ADMIN);
  j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...estimate });
  assert.equal(j.estimateDelivery.status, 'ready', 'published, not emailed yet');
  assert.equal(j.estimateDelivery.to, 'Morag@Example.com');
  const requestId = crypto.randomUUID();
  const issued = await link({ action: 'issue', requestId, propertyId: j.propertyId, tokenHash: hash(2), delivery: 'email' });
  assert.equal(issued.send, true);
  assert.deepEqual([issued.to, issued.name, issued.propertyName, issued.estimate.mediumRateMinor, issued.estimateDelivery.status], ['morag@example.com', 'Morag Example', 'Holmhead flat', 11000, 'sending']);
  const again = await link({ action: 'issue', requestId, propertyId: j.propertyId, tokenHash: hash(3), delivery: 'email' });
  assert.equal(again.id, issued.id, 'a retry is the same link');
  assert.equal((await sql('select count(*)::int n from private.workspace_estimate_links'))[0].n, 1);
  await as(ADMIN);
  assert.equal((await link({ action: 'markEmail', requestId, emailStatus: 'failed' })).estimateDelivery.status, 'ready');
  assert.equal((await link({ action: 'markEmail', requestId, emailStatus: 'failed' })).estimateDelivery.emailFailed, true);
  assert.equal((await link({ action: 'issue', requestId, propertyId: j.propertyId, tokenHash: hash(2), delivery: 'email' })).send, true, 'a failed email may be tried again');
  const sent = await link({ action: 'markEmail', requestId, emailStatus: 'sent' });
  assert.equal(sent.estimateDelivery.status, 'sent');
  assert.ok(sent.estimateDelivery.sentAt);
  assert.equal((await link({ action: 'issue', requestId, propertyId: j.propertyId, tokenHash: hash(2), delivery: 'email' })).send, false, 'sent once');
  await assert.rejects(link({ action: 'issue', requestId, propertyId: phoneOnly.propertyId, tokenHash: hash(2), delivery: 'email' }), /Request identifier reused/);
  // The enquiry's step reads it too.
  j = (await (async () => { await as(ADMIN); return (await db.query('select public.workspace_journey_read($1) result', [j.propertyId])).rows[0].result[0]; })());
  assert.equal(j.estimateDelivery.status, 'sent');
});

test('a republished estimate is "ready" again until its own email goes', async () => {
  await as(ADMIN);
  j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, ...estimate, mediumRateMinor: 12000 });
  assert.equal(j.estimateDelivery.status, 'ready');
});

test('who may issue: the onboarding team on that property only; no email address means Copy link only', async () => {
  for (const who of [CLEANER, OTHER_STAYS]) {
    await as(who);
    await assert.rejects(link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash: hash(10 + who), delivery: 'link' }), /Onboarding access denied/);
  }
  await as(ADMIN);
  phoneOnly = await journey({ action: 'publishEstimate', propertyId: phoneOnly.propertyId, version: phoneOnly.version, ...estimate });
  await assert.rejects(link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: phoneOnly.propertyId, tokenHash: hash(20), delivery: 'email' }), /no email address/);
  const copied = await link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: phoneOnly.propertyId, tokenHash: hash(21), delivery: 'link' });
  assert.deepEqual([copied.send, copied.delivery, copied.emailStatus, copied.to, copied.estimateDelivery.status], [false, 'link', 'manual', null, 'ready']);
  await assert.rejects(link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash: 'nope', delivery: 'link' }), /Invalid estimate link/);
  await assert.rejects(link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash: hash(22), delivery: 'link', extra: 1 }));
  await assert.rejects(db.query('select * from private.workspace_estimate_links'), /permission denied/);
  await assert.rejects(db.query('select public.workspace_estimate_public($1::jsonb)', [JSON.stringify({ action: 'open', tokenHash: hash(2) })]), /permission denied/);
});

test('the client opens the link without an account and sees the current estimate; bad or unknown links are refused', async () => {
  const opened = await pub({ action: 'open', tokenHash: hash(2) });
  assert.deepEqual([opened.state, opened.propertyName, opened.name, opened.estimate.mediumRateMinor, opened.estimate.comparables.length], ['open', 'Holmhead flat', 'Morag Example', 12000, 1]);
  assert.ok((await sql('select opened_at from private.workspace_estimate_links where token_hash=$1', [hash(2)]))[0].opened_at);
  await assert.rejects(pub({ action: 'open', tokenHash: hash(999) }), /This link is not valid/);
  await assert.rejects(pub({ action: 'open', tokenHash: 'x' }), /This link is not valid/);
  await assert.rejects(pub({ action: 'open', tokenHash: hash(2), extra: 1 }));
  for (const u of users) { await as(users.indexOf(u)); await assert.rejects(db.query('select public.workspace_estimate_public($1::jsonb)', [JSON.stringify({ action: 'open', tokenHash: hash(2) })]), /permission denied/); }
});

test('Review later needs a date; it is recorded as the team would record it, and the client can decide again later', async () => {
  await assert.rejects(pub({ action: 'decide', tokenHash: hash(2), decision: 'review' }), /follow-up date/);
  await assert.rejects(pub({ action: 'decide', tokenHash: hash(2), decision: 'review', followUpOn: '2020-01-01' }), /follow-up date/);
  await assert.rejects(pub({ action: 'decide', tokenHash: hash(2), decision: 'maybe' }), /Choose Proceed/);
  const later = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const r = await pub({ action: 'decide', tokenHash: hash(2), decision: 'review', followUpOn: later, feedback: '  Talking to my partner.  ' });
  assert.deepEqual([r.state, r.stage, r.followUpOn, r.feedback], ['open', 'reviewing', later, 'Talking to my partner.']);
  const [row] = await sql('select stage,follow_up_on::text f,feedback,version from private.workspace_journeys where property_id=$1', [j.propertyId]);
  assert.deepEqual([row.stage, row.f, row.feedback], ['reviewing', later, 'Talking to my partner.']);
  assert.ok(row.version > j.version, 'the team’s open copy is now out of date');
  assert.equal((await sql("select count(*)::int n from public.workspace_activity where property_id=$1 and event_type='journey.decideEstimate'", [j.propertyId]))[0].n, 1, 'the team is told');
});

test('Proceed moves the journey to the agreement; the link then only shows the outcome', async () => {
  const r = await pub({ action: 'decide', tokenHash: hash(2), decision: 'proceed', feedback: '' });
  assert.deepEqual([r.state, r.stage, r.followUpOn], ['proceeding', 'agreement', null]);
  await assert.rejects(pub({ action: 'decide', tokenHash: hash(2), decision: 'decline' }), /can no longer be answered/);
  assert.equal((await pub({ action: 'open', tokenHash: hash(2) })).state, 'proceeding');
  assert.deepEqual((await sql('select decision from private.workspace_estimate_links where token_hash=$1', [hash(2)]))[0], { decision: 'proceed' });
  await as(ADMIN);
  await assert.rejects(link({ action: 'issue', requestId: crypto.randomUUID(), propertyId: j.propertyId, tokenHash: hash(30), delivery: 'link' }), /Only a published estimate/, 'past the estimate, no new links');
});

test('Decline archives the property and its onboarding, as the team’s decline does; an expired link cannot decide', async () => {
  await sql("update private.workspace_estimate_links set expires_at=now()-interval '1 day' where token_hash=$1", [hash(21)]);
  assert.equal((await pub({ action: 'open', tokenHash: hash(21) })).state, 'expired');
  await assert.rejects(pub({ action: 'decide', tokenHash: hash(21), decision: 'decline' }), /can no longer be answered/);
  await sql("update private.workspace_estimate_links set expires_at=now()+interval '1 day' where token_hash=$1", [hash(21)]);
  const r = await pub({ action: 'decide', tokenHash: hash(21), decision: 'decline', feedback: 'Selling instead.' });
  assert.equal(r.state, 'declined');
  const [p] = await sql('select p.status,w.status work from public.workspace_properties p join private.workspace_journeys j on j.property_id=p.id join public.workspace_work_items w on w.id=j.work_id where p.id=$1', [phoneOnly.propertyId]);
  assert.deepEqual(p, { status: 'archived', work: 'declined' });
});
