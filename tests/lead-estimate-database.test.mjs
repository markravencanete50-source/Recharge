import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Leads and Estimate Delivery (migration 20261025300000): a lead's ticket reads the enquiry, our properties, local events and
// repair work; its five Estimate Delivery steps are ticked in order (the last by the existing publish); a new estimate takes
// up to 3 comparables; the team comments on the lead; only the people who work with enquiries can do any of it; and the
// migration runs twice without changing anything.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { journeyActionSchema, MAX_COMPARABLES } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { clientEnquiriesSchema } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { estimateComparables } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const lead = await vite.ssrLoadModule('/lib/lead-estimate.ts');
const MINE = '20261025300000_lead_estimate_delivery.sql';
// Internal Analysis is approved by the Property Performance Manager (20261031100000), which replaces two of MINE's functions.
const APPROVAL = '20261031100000_lead_manager_approval.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));

const roles = ['super_admin', 'admin', 'stays', 'stays', 'client', 'cleans'];
const users = roles.map((_, i) => `97750000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, STAYS_NO_MODULE, OWNER, CLEANER] = roles.map((_, i) => i);
const NAMES = ['Sam', 'Morag', 'Fiona', 'Ewan', 'Jamie Owner', 'Isla'];
const session = i => users[i].replace('9775', '9875');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `lead${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], NAMES[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
  if (i !== STAYS_NO_MODULE) for (const m of ['property-onboarding', 'client-dashboard']) await db.query('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [users[i], m]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async (i, input) => { await as(i); return lead.leadStateSchema.parse(await rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })])); };
const raw = async (i, input) => { await as(i); return rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]); };
const journey = async (i, input) => { await as(i); return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]); };
const read = async (i, enquiryId) => { teamsReadSchema.parse({ section: 'lead', enquiryId }); await as(i); return lead.leadReadSchema.parse(await rpc('workspace_lead_read', [enquiryId])); };
const notified = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
after(async () => { await db.close(); await vite.close(); });

// The lead: added by the team after a phone call, in Edinburgh (Leith). Our properties: one in Edinburgh (about 2 miles),
// one in Glasgow (about 42 miles), one archived nearby.
const j0 = await journey(ADMIN, { action: 'createEnquiry', name: 'Leith Walk flat', address: '12 Leith Walk, Edinburgh EH6 5AB', propertyType: 'Flat', bedrooms: 2, bathrooms: 1, enquiry: { contactName: 'Pat Lead', email: 'pat@example.com', phone: '07700 900111' } });
await as(ADMIN);
const enquiry = clientEnquiriesSchema.parse(await rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null])).items.find(e => e.propertyId === j0.propertyId);
await sql('update public.workspace_properties set latitude=55.9667,longitude=-3.1747 where id=$1', [j0.propertyId]);
const place = async (name, lat, lon, status = 'active') => (await sql("insert into public.workspace_properties(name,address,status,bedrooms,created_by,request_id,latitude,longitude) values($1,$2,$3,2,$4,gen_random_uuid(),$5,$6) returning id", [name, name + ', Scotland', status, users[ADMIN], lat, lon]))[0].id;
const NEAR = await place('Old Town flat', 55.9496, -3.1907);
const FAR = await place('Merchant City flat', 55.8601, -4.2468);
await place('Archived cottage', 55.95, -3.19, 'archived');
// Stays at the Old Town flat: 20 nights in the last few months, with payouts; an owner stay that never counts.
const today = (await sql("select (now() at time zone 'Europe/London')::date::text d"))[0].d;
const day = n => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
for (const [i, from, nights, payout] of [[1, -60, 5, 60000], [2, -40, 7, 84000], [3, -20, 8, 96000]]) await sql("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,payout_minor) values($1,$2,$3,$4,'confirmed','manual',$5,$6)", [NEAR, 'R' + i, day(from), day(from + nights), users[ADMIN], payout]);
await sql("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,channel_reference) values($1,'OWN',$2,$3,'confirmed','manual',$4,'other','Owner stay')", [NEAR, day(-10), day(-5), users[ADMIN]]);
await sql("insert into private.workspace_local_events(property_id,name,event_on,source_url,opportunity,created_by) values($1,'Edinburgh Festival Fringe',$2,'https://www.edfringe.com','Busy August: raise rates',$3),($4,'Celtic Connections',$5,'https://www.celticconnections.com','Glasgow in January',$3),($1,'Last year''s show',$6,'https://example.com','Gone already',$3)", [NEAR, day(60), users[ADMIN], FAR, day(90), day(-30)]);
const work = (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,due_on) values(gen_random_uuid(),$1,'maintenance-reporting','Boiler service',$2,$3) returning id", [NEAR, users[ADMIN], day(14)]))[0].id;
await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'maintenance','{\"assignedReadyName\":\"Ally Plumbing\"}')", [work]);

const SIGS = ['private.workspace_journey_action(jsonb)', 'private.workspace_teams_action(jsonb)', 'private.workspace_lead_action(jsonb)', 'private.workspace_lead_read(uuid)', 'private.workspace_lead_step_data(text,jsonb,boolean,uuid)'];
const definitions = async () => { await db.exec('reset role'); return Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d)); };

test('the ticket reads the lead, our properties with their figures, events and repair work; the app keeps those within 30 miles', async () => {
  const r = await read(ADMIN, enquiry.id);
  assert.equal(r.enquiry.id, enquiry.id); assert.equal(r.journey.stage, 'enquiry'); assert.equal(r.steps.length, 0);
  assert.deepEqual(r.ours.map(o => o.name).sort(), ['Merchant City flat', 'Old Town flat'], 'archived properties and the lead itself are left out');
  const from = lead.placeOf(r.property);
  assert.equal(from.precision, 'exact');
  const rows = lead.internalRows(r, from);
  assert.deepEqual(rows.map(x => x.name), ['Old Town flat'], 'Glasgow is over 30 miles away');
  assert.ok(rows[0].miles > 1 && rows[0].miles < 3, String(rows[0].miles));
  const near = r.ours.find(o => o.id === NEAR).stats;
  assert.equal(near.stays, 3, 'the owner stay never counts'); assert.equal(near.nights, 20);
  assert.equal(near.adrMinor, 12000); assert.equal(near.revenueMinor, 240000);
  assert.equal(near.occupancyBps, Math.round(10000 * 20 / 365));
  assert.equal(near.trend.length, 6);
  const items = lead.localItems(r, from);
  assert.deepEqual(items.map(x => [x.kind, x.name]), [['repair', 'Boiler service'], ['event', 'Edinburgh Festival Fringe']], 'Glasgow and past events are left out');
  assert.match(items[0].note, /Ally Plumbing/);
  // Without a position (and no postcode we know) the app says so and the consultant goes on with notes.
  assert.equal(lead.placeOf({ latitude: null, longitude: null, address: 'Somewhere without a postcode' }), null);
  assert.deepEqual(lead.internalRows(r, null), []);
});

test('the steps tick in order, each with a receipt; Submit Estimate is ticked by the existing publish', async () => {
  let r = await read(STAYS, enquiry.id);
  const from = lead.placeOf(r.property);
  await assert.rejects(act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: { reportUrl: 'https://app.pricelabs.co/report/1', averageRateMinor: 11000 }, done: true }), /Finish the steps before this one first/);
  // A draft saves without ticking; then Internal Analysis is approved.
  let s = await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: lead.internalRows(r, from), notes: '' }, done: false });
  assert.equal(s.steps[0].tickedAt, null);
  assert.throws(() => teamsActionSchema.parse({ action: 'saveLeadStep', requestId: crypto.randomUUID(), enquiryId: enquiry.id, step: 'internal', data: { rows: [], notes: '' }, done: true }), /Add a note/);
  await assert.rejects(raw(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: [{ propertyId: FAR, name: 'Merchant City flat', miles: 42 }] }, done: true }), /Only properties within 30 miles/);
  // Fiona's Approve sends it to the Property Performance Manager (admins, and whoever they name) instead of ticking it.
  s = await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: lead.internalRows(r, from), notes: 'Old Town flat is the closest match.' }, done: true });
  assert.equal(lead.isTicked(s.steps, 'internal'), false); assert.ok(lead.isWaiting(s.steps, 'internal'));
  assert.equal(s.steps[0].sentByName, 'Fiona'); assert.equal(s.canApprove, false);
  assert.equal(await notified(ADMIN, 'enquiry.lead_approval'), 1); assert.equal(await notified(STAYS, 'enquiry.lead_approval'), 0);
  await assert.rejects(act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: [], notes: 'Changed' }, done: false }), /with the Property Performance Manager/);
  await assert.rejects(act(STAYS, { action: 'approveLeadStep', enquiryId: enquiry.id, step: 'internal' }), /Only the Property Performance Manager/);
  await assert.rejects(act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: { reportUrl: 'https://app.pricelabs.co/report/1', averageRateMinor: 11000 }, done: true }), /Finish the steps before this one first/);
  // The manager's list, then a return with a note: Fiona is told and can change it again.
  await as(ADMIN); let waiting = lead.leadApprovalsSchema.parse(await rpc('workspace_lead_approvals'));
  assert.equal(waiting.canApprove, true); assert.deepEqual(waiting.items.map(x => [x.enquiryId, x.step, x.sentByName]), [[enquiry.id, 'internal', 'Fiona']]);
  await as(STAYS); assert.deepEqual(lead.leadApprovalsSchema.parse(await rpc('workspace_lead_approvals')), { canApprove: false, items: [] });
  assert.throws(() => teamsActionSchema.parse({ action: 'returnLeadStep', requestId: crypto.randomUUID(), enquiryId: enquiry.id, step: 'internal', note: 'x' }), /at least 3/);
  s = await act(ADMIN, { action: 'returnLeadStep', enquiryId: enquiry.id, step: 'internal', note: 'Add the Glasgow trend too.' });
  assert.equal(lead.isWaiting(s.steps, 'internal'), false); assert.equal(s.steps[0].returnedNote, 'Add the Glasgow trend too.'); assert.equal(s.steps[0].returnedByName, 'Morag');
  assert.equal(await notified(STAYS, 'enquiry.lead_returned'), 1);
  assert.equal(lead.leadChecklist(await read(STAYS, enquiry.id))[1].subSteps[0].returned, true);
  await assert.rejects(act(ADMIN, { action: 'approveLeadStep', enquiryId: enquiry.id, step: 'internal' }), /Nothing on this step is waiting/);
  s = await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: lead.internalRows(r, from), notes: 'Old Town flat is the closest match.' }, done: true });
  assert.equal(s.steps[0].returnedNote, null, 'sending again clears the note');
  // Taking it back, then sending it again; the manager approves it and Fiona is told.
  s = await act(STAYS, { action: 'reopenLeadStep', enquiryId: enquiry.id, step: 'internal' });
  assert.equal(lead.isWaiting(s.steps, 'internal'), false);
  await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: lead.internalRows(r, from), notes: 'Old Town flat is the closest match.' }, done: true });
  s = await act(ADMIN, { action: 'approveLeadStep', enquiryId: enquiry.id, step: 'internal' });
  assert.ok(lead.isTicked(s.steps, 'internal'));
  assert.equal(s.steps[0].tickedByName, 'Morag');
  assert.equal(await notified(STAYS, 'enquiry.lead_approved'), 1);
  await as(ADMIN); waiting = lead.leadApprovalsSchema.parse(await rpc('workspace_lead_approvals')); assert.deepEqual(waiting.items, []);
  await assert.rejects(act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'internal', data: { rows: [], notes: 'Changed' }, done: false }), /Reopen it to change it/);
  // External Analysis: up to 3 comparables, the report and the average nightly rate.
  const comp = i => ({ name: 'Leith flat ' + i, url: 'https://www.airbnb.co.uk/rooms/' + i, adrMinor: 10000 + i * 500 });
  const four = { reportUrl: 'https://app.pricelabs.co/report/1', comparables: [1, 2, 3, 4].map(comp), averageRateMinor: 11000 };
  assert.throws(() => teamsActionSchema.parse({ action: 'saveLeadStep', requestId: crypto.randomUUID(), enquiryId: enquiry.id, step: 'external', data: four, done: true }), /Up to 3 comparables/);
  await assert.rejects(raw(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: four, done: true }), /Up to 3 comparables/);
  await assert.rejects(act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: { comparables: [comp(1)], averageRateMinor: 11000 }, done: false }).then(() => raw(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: { comparables: [comp(1)], averageRateMinor: 11000 }, done: true })), /Add the PriceLabs report/);
  // The report as a file (the server stores the bytes; the database keeps the record).
  const fileId = crypto.randomUUID();
  await as(STAYS);
  const withFile = lead.leadStateSchema.parse(await rpc('workspace_lead_file_action', [{ action: 'addFile', enquiryId: enquiry.id, fileId, path: `leads/${enquiry.id}/${fileId}.pdf`, name: 'PriceLabs Leith.pdf', mime: 'application/pdf', bytes: 120000 }]));
  assert.deepEqual(withFile.files.map(f => f.name), ['PriceLabs Leith.pdf']);
  await assert.rejects(rpc('workspace_lead_file_action', [{ action: 'addFile', enquiryId: enquiry.id, fileId: crypto.randomUUID(), path: `leads/${crypto.randomUUID()}/x.pdf`, name: 'x.pdf', mime: 'application/pdf', bytes: 10 }]), /Invalid file/);
  assert.deepEqual(await rpc('workspace_lead_file', [enquiry.id, fileId]), { path: `leads/${enquiry.id}/${fileId}.pdf`, name: 'PriceLabs Leith.pdf', mime: 'application/pdf' });
  s = await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: { reportUrl: '', reportFileId: fileId, comparables: [1, 2, 3].map(comp), averageRateMinor: 11000, notes: '' }, done: true });
  assert.ok(lead.isTicked(s.steps, 'external'));
  // Local Area Analysis, then Estimated Revenue (rates in order).
  r = await read(STAYS, enquiry.id);
  s = await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'local', data: { items: lead.localItems(r, from), notes: 'Fringe in August.' }, done: true });
  await assert.rejects(raw(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'revenue', data: { lowRateMinor: 12000, mediumRateMinor: 10000, highRateMinor: 15000 }, done: true }), /expected nightly rate must be at least the low/);
  s = await act(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'revenue', data: { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 15000, occupancyBps: 7500, managementFeeBps: 1800, ownCosts: [{ category: 'Mortgage', monthlyMinor: 80000 }], comments: 'Strong in summer.' }, done: true });
  assert.equal(lead.nextLeadStep(s.steps), 'submit');
  // Submit Estimate is never ticked by hand.
  assert.throws(() => teamsActionSchema.parse({ action: 'saveLeadStep', requestId: crypto.randomUUID(), enquiryId: enquiry.id, step: 'submit', data: {}, done: true }));
  await assert.rejects(raw(STAYS, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'submit', data: {}, done: true }), /Submit the estimate to finish this step/);
  // The existing publish, built from the steps: it ticks Submit Estimate, and the checklist moves on to Sign Agreement.
  r = await read(STAYS, enquiry.id);
  const body = lead.estimateFromSteps(r);
  assert.equal(body.action, 'publishEstimate'); assert.equal(body.comparables.length, 3); assert.equal(body.occupancyBps, 7500);
  const published = await journey(STAYS, body);
  assert.equal(published.stage, 'estimate'); assert.equal(published.estimate.comparables.length, 3); assert.deepEqual(published.estimate.ownCosts, [{ category: 'Mortgage', monthlyMinor: 80000 }]);
  r = await read(ADMIN, enquiry.id);
  assert.ok(lead.estimateDelivered(r.steps));
  const checklist = lead.leadChecklist(r);
  assert.deepEqual(checklist.map(c => [c.label, c.state]).slice(0, 3), [['Enquiry received', 'done'], ['Estimate Delivery', 'done'], ['Sign Agreement', 'current']]);
  assert.deepEqual(checklist[1].subSteps.map(x => x.state), ['done', 'done', 'done', 'done', 'done']);
  const feed = lead.leadFeed(r).map(lead.feedWords);
  assert.ok(feed.includes('Fiona sent Internal Analysis to the Property Performance Manager'), feed.join(' | '));
  assert.ok(feed.includes('Morag returned Internal Analysis: Add the Glasgow trend too.'));
  assert.ok(feed.includes('Morag approved Internal Analysis'));
  assert.ok(feed.includes('Fiona submitted the estimate to the client'));
  assert.ok(feed.includes('Morag added the lead by hand'));
});

test('a new estimate takes up to 3 comparables; one saved with more still reads', async () => {
  assert.equal(MAX_COMPARABLES, 3);
  const r = await read(ADMIN, enquiry.id);
  const comps = n => Array.from({ length: n }, (_, i) => ({ name: 'Flat ' + i, url: 'https://www.airbnb.co.uk/rooms/9' + i, adrMinor: 9000 }));
  const base = { action: 'publishEstimate', propertyId: r.journey.propertyId, version: r.journey.version, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comments: '' };
  assert.throws(() => journeyActionSchema.parse({ requestId: crypto.randomUUID(), ...base, comparables: comps(4) }), /Up to 3 comparables/);
  await as(ADMIN);
  await assert.rejects(rpc('workspace_journey_action', [{ requestId: crypto.randomUUID(), ...base, comparables: comps(4) }]), /Invalid estimate/);
  // An estimate published before, with 8 comparables, still reads in full.
  await sql("update private.workspace_journeys set estimate=jsonb_set(estimate,'{comparables}',$2::jsonb) where property_id=$1", [r.journey.propertyId, JSON.stringify(comps(8))]);
  const saved = (await read(ADMIN, enquiry.id)).journey.estimate;
  assert.equal(estimateComparables(saved).length, 8);
});

test('reopening a step reopens the steps after it, until the owner moves on', async () => {
  let s = await act(ADMIN, { action: 'reopenLeadStep', enquiryId: enquiry.id, step: 'external' });
  assert.deepEqual(lead.LEAD_STEPS.map(x => lead.isTicked(s.steps, x)), [true, false, false, false, false]);
  await assert.rejects(act(ADMIN, { action: 'reopenLeadStep', enquiryId: enquiry.id, step: 'local' }), /not done yet/);
  assert.equal(lead.leadChecklist(await read(ADMIN, enquiry.id))[1].state, 'current');
  // The owner (recorded by the team: there is no owner account) proceeds: the estimate steps are closed.
  const r = await read(ADMIN, enquiry.id);
  await journey(ADMIN, { action: 'decideEstimate', propertyId: r.journey.propertyId, version: r.journey.version, decision: 'proceed', feedback: '' });
  await assert.rejects(act(ADMIN, { action: 'saveLeadStep', enquiryId: enquiry.id, step: 'external', data: {}, done: false }), /The estimate is finished for this lead/);
  const after = lead.leadChecklist(await read(ADMIN, enquiry.id));
  assert.deepEqual(after.map(c => c.state).slice(0, 3), ['done', 'done', 'current'], 'past the estimate, Estimate Delivery counts as done');
});

test('comments: kept on the lead, alongside its history, and the team on it hears', async () => {
  const s = await act(STAYS, { action: 'addLeadComment', enquiryId: enquiry.id, text: 'Called Pat: happy with the numbers.' });
  const comment = s.activity.find(x => x.kind === 'comment');
  assert.deepEqual([comment.text, comment.byName], ['Called Pat: happy with the numbers.', 'Fiona']);
  assert.equal(await notified(ADMIN, 'enquiry.lead_comment'), 1, 'Morag added the lead');
  assert.equal(await notified(STAYS, 'enquiry.lead_comment'), 0, 'never your own');
  await act(ADMIN, { action: 'addLeadComment', enquiryId: enquiry.id, text: 'Thanks, sending the agreement.' });
  assert.equal(await notified(STAYS, 'enquiry.lead_comment'), 1, 'Fiona commented, so she hears the reply');
  assert.throws(() => teamsActionSchema.parse({ action: 'addLeadComment', requestId: crypto.randomUUID(), enquiryId: enquiry.id, text: '' }));
  // The same request twice is answered once; the same id with another comment is refused.
  const requestId = crypto.randomUUID(), input = { action: 'addLeadComment', requestId, enquiryId: enquiry.id, text: 'Once only' };
  await as(ADMIN); const first = await rpc('workspace_teams_action', [input]);
  await as(ADMIN); assert.deepEqual(await rpc('workspace_teams_action', [input]), first);
  await as(ADMIN); await assert.rejects(rpc('workspace_teams_action', [{ ...input, text: 'Another' }]), /Request identifier reused/);
  assert.equal((await sql("select count(*)::int n from private.workspace_lead_activity where body='Once only'"))[0].n, 1);
});

test('staff with enquiry access only: owners, cleaners and Stays without onboarding are refused, and nobody reads the tables', async () => {
  for (const i of [OWNER, CLEANER, STAYS_NO_MODULE]) {
    await as(i); await assert.rejects(rpc('workspace_lead_read', [enquiry.id]), /access required|Active access/, NAMES[i]);
    await assert.rejects(raw(i, { action: 'addLeadComment', enquiryId: enquiry.id, text: 'Hello' }), /access required|Active access/, NAMES[i]);
    await as(i); await assert.rejects(rpc('workspace_lead_file', [enquiry.id, crypto.randomUUID()]), /access required|Active access/, NAMES[i]);
  }
  await as(SUPER); assert.ok(await rpc('workspace_lead_read', [enquiry.id]));
  await as(ADMIN);
  for (const t of ['workspace_lead_steps', 'workspace_lead_activity', 'workspace_lead_files']) await assert.rejects(db.query(`select * from private.${t}`), /permission denied/);
  for (const f of ['private.workspace_lead_action(jsonb)', 'private.workspace_lead_step_data(text,jsonb,boolean,uuid)', 'private.workspace_lead_estimate_published(uuid)', 'private.workspace_lead_state(uuid)', 'private.workspace_lead_property_stats(uuid,date)'])
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await sql('select has_function_privilege($1,$2,\'execute\') ok', [role, f]))[0].ok, false, `${role} ${f}`);
});

test('the migration runs twice without changing anything', async () => {
  const before = await definitions();
  const counts = 'select (select count(*) from private.workspace_lead_steps)::int s,(select count(*) from private.workspace_lead_activity)::int a,(select count(*) from private.workspace_lead_files)::int f';
  const rows = (await sql(counts))[0];
  const text = await fs.readFile('supabase/migrations/' + MINE, 'utf8'), later = await fs.readFile('supabase/migrations/' + APPROVAL, 'utf8');
  await db.exec(text); await db.exec(later);
  assert.deepEqual(await definitions(), before);
  assert.deepEqual((await sql(counts))[0], rows);
  assert.equal(before[0].split('estimate comparables three: 20261025300000').length, 2, 'patched once');
  assert.equal(before[0].split('lead estimate delivery: 20261025300000').length, 2, 'patched once');
  assert.equal(before[1].split('lead actions: 20261025300000').length, 2, 'patched once');
  assert.equal(before[1].split('lead manager approval: 20261031100000').length, 2, 'patched once');
  assert.equal(later.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  assert.equal(text.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  assert.doesNotMatch(text, /\bdelete\s+from\b|\bdrop\s+table\b/i);
});
