import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Management oversight: owners reminded after 48 hours and client relations told after 96 (once
// each), yesterday's missed Stays checks rolled over for management, unusual owner payouts, the
// business overview and each item's history, and who may read or change any of it.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { managementSchema } = await vite.ssrLoadModule('/lib/management-live.ts');
const { overviewSchema, historySchema, decisionsSchema, oversightActionSchema, historyRows, decisionsCsv } = await vite.ssrLoadModule('/lib/oversight-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'client', 'stays', 'stays', 'stays', 'accounts', 'cleans'];
const names = ['Ada Admin', 'Olive Owner', 'Anna', 'Cara', 'Ben', 'Accounts', 'Cleo'];
const users = roles.map((_, i) => `99500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9950', '9960');
const [ADMIN, OWNER, ANNA, CARA, BEN, ACCOUNTS, CLEANER] = [0, 1, 2, 3, 4, 5, 6];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `oversight${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function system() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
async function asBackend() { await system(); await db.exec('set role service_role'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const ops = input => rpc('workspace_operations_action', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })]);
const journey = input => rpc('workspace_journey_action', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })]);
const act = input => rpc('workspace_oversight_action', [oversightActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = (section, target = null) => rpc('workspace_oversight_read', [section, target]);
const queue = async () => managementSchema.parse(await rpc('workspace_teams_read', ['management', null, null, null, null]));
// The system jobs, as the backend runs them, at a chosen moment.
const chase = async when => { await system(); return (await db.query(`select private.workspace_chase_owner_approvals(${when}) r`)).rows[0].r; };
const rollOver = async when => { await system(); return (await db.query(`select private.workspace_roll_over_signoffs(${when}) r`)).rows[0].r; };
const notices = async (user, event, work) => { await system(); return (await db.query('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2 and ($3::uuid is null or a.work_id=$3)', [users[user], event, work ?? null])).rows[0].n; };
const londonToday = (await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
const londonAt = (hour, days = 0) => `((date '${londonToday}' + ${days}) + time '${String(hour).padStart(2, '0')}:00') at time zone 'Europe/London'`;
const yesterday = (await db.query(`select (date '${londonToday}' - 1)::text d`)).rows[0].d;

// Three live properties. Anna and Cara (client relations) look after Harbour Flat; Anna also Castle
// Loft; Ben looks after Loch House. Olive owns Harbour Flat.
await as(ADMIN);
const property = async name => rpc('workspace_save_property', [JSON.stringify({ requestId: crypto.randomUUID(), name, address: 'Example address', region: 'Edinburgh', bedrooms: 2, status: 'active' })]);
const HARBOUR = await property('Harbour Flat'), CASTLE = await property('Castle Loft'), LOCH = await property('Loch House');
for (const [prop, who, assignment] of [[HARBOUR, OWNER, 'client'], [HARBOUR, ANNA, 'staff'], [HARBOUR, CARA, 'staff'], [CASTLE, ANNA, 'staff'], [LOCH, BEN, 'staff']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [prop, users[who], assignment]);
await system();
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early'),($2,'guest_relations','early'),($3,'guest_relations','late')", [users[CARA], users[ANNA], users[BEN]]);

let boiler, journeyWork;
test('an owner is reminded once after 48 hours, then client relations once after 96', async () => {
  await as(ANNA);
  boiler = await ops({ action: 'createOperation', propertyId: HARBOUR, kind: 'maintenance', data: { issue: 'Boiler not firing, no heating', estimatedCostMinor: 45000, hazard: false, repairType: 'heating' } });
  assert.equal(boiler.data.phase, 'owner_approval');
  assert.ok(boiler.data.ownerApprovalSince, 'the wait is stamped when it starts');

  assert.deepEqual(await chase("now()+interval '47 hours'"), { reminded: 0, escalated: 0 });
  assert.deepEqual(await chase("now()+interval '49 hours'"), { reminded: 1, escalated: 0 });
  assert.equal(await notices(OWNER, 'repairs.owner_reminder', boiler.workId), 1);
  assert.deepEqual(await chase("now()+interval '60 hours'"), { reminded: 0, escalated: 0 }, 'one reminder only');
  assert.deepEqual(await chase("now()+interval '97 hours'"), { reminded: 0, escalated: 1 });
  assert.deepEqual(await chase("now()+interval '120 hours'"), { reminded: 0, escalated: 0 }, 'one escalation only');
  assert.equal(await notices(OWNER, 'repairs.owner_reminder', boiler.workId), 1);
  // Cara is client relations on Harbour Flat, so she is told; nobody else is.
  assert.equal(await notices(CARA, 'repairs.owner_escalated'), 1);
  for (const who of [ADMIN, ANNA, BEN]) assert.equal(await notices(who, 'repairs.owner_escalated'), 0);

  // Once the owner approves, nothing is chased any more.
  await as(OWNER);
  const approved = await ops({ action: 'updateOperation', workId: boiler.workId, version: boiler.version, step: 'approveBudget', data: { consent: true } });
  assert.equal(approved.data.phase, 'triage');
  assert.deepEqual(await chase("now()+interval '200 hours'"), { reminded: 0, escalated: 0 });
});

test('with nobody in client relations on the property, the escalation goes to client relations, then admins', async () => {
  await as(ANNA);
  const leak = await ops({ action: 'createOperation', propertyId: CASTLE, kind: 'maintenance', data: { issue: 'Leak under the kitchen sink', estimatedCostMinor: 30000, hazard: false, repairType: 'leak' } });
  assert.deepEqual(await chase("now()+interval '97 hours'"), { reminded: 1, escalated: 1 });
  assert.equal(await notices(CARA, 'repairs.owner_escalated'), 2, 'Cara is the only one in client relations');
  await system(); await db.query("update private.workspace_staff_rota set department='guest_relations' where user_id=$1", [users[CARA]]);
  await as(ANNA);
  const lock = await ops({ action: 'createOperation', propertyId: CASTLE, kind: 'maintenance', data: { issue: 'Front door lock sticking', estimatedCostMinor: 20000, hazard: false, repairType: 'locks_access' } });
  assert.deepEqual(await chase("now()+interval '98 hours'"), { reminded: 1, escalated: 1 });
  assert.equal(await notices(ADMIN, 'repairs.owner_escalated'), 1, 'admins when nobody is in client relations');
  await system(); await db.query("update private.workspace_staff_rota set department='client_relations' where user_id=$1", [users[CARA]]);
  // Both go ahead, so later tests start from a clean queue.
  await db.query("update private.workspace_domain_details set data=data||'{\"phase\":\"triage\"}' where work_id=any($1)", [[leak.workId, lock.workId]]);
});

test('management sees how long an owner has waited and can remind them now, once a day', async () => {
  await as(ANNA);
  const fence = await ops({ action: 'createOperation', propertyId: HARBOUR, kind: 'maintenance', data: { issue: 'Garden fence blown down', estimatedCostMinor: 60000, hazard: false, repairType: 'damage' } });
  await system();
  await db.query("update private.workspace_domain_details set data=data||jsonb_build_object('ownerApprovalSince',now()-interval '50 hours') where work_id=$1", [fence.workId]);
  await as(ADMIN);
  let stalled = (await queue()).stalledOwnerApprovals.find(a => a.workId === fence.workId);
  assert.ok(stalled, 'waiting over 48 hours');
  assert.equal(stalled.kind, 'repair');
  assert.ok(Date.now() - Date.parse(stalled.waitingSince) >= 49 * 3600000, 'measured from when it started waiting');
  assert.equal(stalled.remindedAt, null);

  await as(ANNA);
  await assert.rejects(act({ action: 'remindOwner', workId: fence.workId }), /Management access required/);
  await as(ADMIN);
  const sent = await act({ action: 'remindOwner', workId: fence.workId });
  assert.equal(sent.owners, 1);
  assert.equal(await notices(OWNER, 'repairs.owner_reminder', fence.workId), 1);
  await as(ADMIN);
  await assert.rejects(act({ action: 'remindOwner', workId: fence.workId }), /last 24 hours/);
  stalled = (await queue()).stalledOwnerApprovals.find(a => a.workId === fence.workId);
  assert.ok(stalled.remindedAt && stalled.canRemindAt);
  // The reminder sent by hand counts: the 48-hour job doesn't send a second.
  assert.equal((await chase('now()')).reminded, 0);
  assert.equal(await notices(OWNER, 'repairs.owner_reminder', fence.workId), 1);
  await as(ADMIN);
  await assert.rejects(act({ action: 'remindOwner', workId: boiler.workId }), /Nothing on this item is waiting/);
});

test('an estimate waiting for the owner is chased the same way', async () => {
  await as(OWNER);
  let j = await journey({ action: 'createEnquiry', name: 'Glen Cottage', address: 'Example glen address', propertyType: 'Cottage', bedrooms: 3, bathrooms: 2 });
  await as(ADMIN);
  j = await journey({ action: 'publishEstimate', propertyId: j.propertyId, version: j.version, lowRateMinor: 10000, mediumRateMinor: 12000, highRateMinor: 15000, comparables: [] });
  journeyWork = j.workId;
  const first = await chase("now()+interval '49 hours'");
  assert.ok(first.reminded >= 1);
  assert.equal(await notices(OWNER, 'journey.estimate_reminder', j.workId), 1);
  await chase("now()+interval '50 hours'");
  assert.equal(await notices(OWNER, 'journey.estimate_reminder', j.workId), 1);
  await chase("now()+interval '97 hours'");
  await system();
  assert.equal((await db.query("select count(*)::int n from public.workspace_activity where event_type='journey.estimate_escalated' and property_id=$1", [j.propertyId])).rows[0].n, 1);
});

test('the reminder jobs are for the backend only', async () => {
  await as(ADMIN);
  await assert.rejects(rpc('workspace_chase_owner_approvals'), /permission denied/);
  await assert.rejects(rpc('workspace_roll_over_signoffs'), /permission denied/);
  await asBackend();
  assert.equal(typeof (await rpc('workspace_chase_owner_approvals')).reminded, 'number');
  assert.equal(typeof (await rpc('workspace_roll_over_signoffs')).day, 'string');
  await system();
  await db.exec('delete from private.workspace_rollover_runs');
  await db.exec('delete from private.workspace_missed_days');
});

test('yesterday’s missed sign-off and listing checks roll over to management until seen', async () => {
  await system();
  // Anna and Ben both worked yesterday; Cara didn't.
  for (const who of [ANNA, BEN]) await db.query(`insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',${londonAt(9, -1)},${londonAt(17, -1)},gen_random_uuid())`, [users[who]]);
  // Ben checked Loch House and signed off; Anna checked Harbour Flat only and didn't sign off.
  await as(ANNA);
  await ops({ action: 'createOperation', propertyId: HARBOUR, kind: 'listing_health', data: { checkedOn: yesterday, platform: 'Airbnb', listingVisible: true, reviewSentiment: 'none', reviewAcknowledged: false, suspended: false, evidence: 'Listing live, calendar right' } });
  await as(BEN);
  await ops({ action: 'createOperation', propertyId: LOCH, kind: 'listing_health', data: { checkedOn: yesterday, platform: 'Airbnb', listingVisible: true, reviewSentiment: 'none', reviewAcknowledged: false, suspended: false, evidence: 'Listing live, calendar right' } });
  await system();
  await db.query("insert into private.workspace_daily_signoffs(user_id,day,confirmations,snapshot) values($1,$2,'{}','{}')", [users[BEN], yesterday]);

  assert.equal((await rollOver(londonAt(7))).ran, false, 'not before 08:00');
  assert.deepEqual(await rollOver(londonAt(9)), { day: yesterday, ran: true, missed: 1 });
  assert.equal((await rollOver(londonAt(11))).ran, false, 'once a day');
  assert.equal(await notices(ADMIN, 'stays.missed_yesterday'), 1);

  await as(ADMIN);
  const missed = (await queue()).missedYesterday;
  assert.equal(missed.length, 1);
  assert.deepEqual([missed[0].fullName, missed[0].day, missed[0].signedOff, missed[0].listingsDue, missed[0].missedListings.map(m => m.propertyName)], ['Anna', yesterday, false, 2, ['Castle Loft']]);

  await as(ANNA);
  await assert.rejects(act({ action: 'markMissedSeen', userId: users[ANNA], day: yesterday }), /Management access required/);
  await assert.rejects(rpc('workspace_teams_read', ['management', null, null, null, null]), /Management access required/);
  await as(ADMIN);
  await act({ action: 'markMissedSeen', userId: users[ANNA], day: yesterday });
  assert.deepEqual((await queue()).missedYesterday, []);
  await assert.rejects(act({ action: 'markMissedSeen', userId: users[ANNA], day: yesterday }), /Already marked/);
});

test('unusual owner payouts: negative, or more than half off the last three statements’ average', async () => {
  await system();
  const statement = (prop, period, status, payout) => db.query(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by)
    values($1,$2,$3,0,0,0,0,0,0,$4,'{"stays":[],"expenses":[],"cleaningCostMinor":0}',$5) returning id`, [prop, period, status, payout, users[ADMIN]]).then(r => r.rows[0].id);
  for (const [period, payout] of [['2026-05-01', 100000], ['2026-06-01', 110000], ['2026-07-01', 90000]]) await statement(HARBOUR, period, 'paid', payout);
  const low = await statement(HARBOUR, '2026-08-01', 'draft', 30000);
  for (const period of ['2026-06-01', '2026-07-01', '2026-08-01']) await statement(CASTLE, period, 'paid', 100000);
  await statement(CASTLE, '2026-09-01', 'issued', 160000);
  await statement(CASTLE, '2026-10-01', 'draft', 105000);
  await statement(LOCH, '2026-09-01', 'draft', -5000);

  await as(ADMIN);
  let unusual = (await queue()).unusualPayouts;
  assert.deepEqual(Object.fromEntries(unusual.map(u => [u.propertyName + ' ' + u.period, u.reason])), { 'Harbour Flat 2026-08': 'low', 'Castle Loft 2026-09': 'high', 'Loch House 2026-09': 'negative' });
  const harbour = unusual.find(u => u.id === low);
  assert.deepEqual([harbour.averageMinor, harbour.previousStatements], [100000, 3]);

  await as(ACCOUNTS);
  await assert.rejects(act({ action: 'approvePayout', statementId: low, version: harbour.version }), /Management access required/);
  await as(ADMIN);
  await assert.rejects(act({ action: 'approvePayout', statementId: low, version: harbour.version + 1 }), /changed/);
  await act({ action: 'approvePayout', statementId: low, version: harbour.version, note: 'Two weeks blocked for the new kitchen' });
  unusual = (await queue()).unusualPayouts;
  assert.ok(!unusual.some(u => u.id === low), 'approved payouts leave the list');
  const decisions = decisionsSchema.parse(await read('decisions'));
  const payout = decisions.find(d => d.decision === 'Owner payout approved');
  assert.deepEqual([payout.amountMinor, payout.by, payout.note], [30000, 'Ada Admin', 'Two weeks blocked for the new kitchen']);
  assert.ok(decisions.some(d => d.decision === 'Repair approved by the owner' && d.by === 'Olive Owner'));
  assert.match(decisionsCsv(decisions), /^\uFEFF"When","Area","Decision","Outcome","Property","Item","Amount","By","Note"\r\n/);
  assert.match(decisionsCsv(decisions), /"Owner payout approved","Approved","Harbour Flat","2026-08 statement","300.00","Ada Admin"/);
});

test('the business overview is for management only; an item’s history follows the item’s access', async () => {
  await as(ADMIN);
  const overview = overviewSchema.parse(await read('overview'));
  assert.equal(overview.today, londonToday);
  assert.ok(overview.stays.listingsToCheck >= 2);
  assert.ok(overview.stays.emptyNights >= 7);
  assert.ok(overview.ready.ownerApproval >= 1);
  assert.equal(overview.accounts.statementsToIssue, 3);
  for (const who of [ANNA, ACCOUNTS, OWNER, CLEANER]) {
    await as(who);
    await assert.rejects(read('overview'), /Management access required/);
    await assert.rejects(read('decisions'), /Management access required/);
  }

  await as(ANNA);
  const history = historySchema.parse(await read('history', boiler.workId));
  const rows = historyRows(history);
  assert.ok(rows.some(r => r.label === 'Repair reported' && r.note === 'Boiler not firing, no heating' && r.by === 'Anna'));
  assert.ok(rows.some(r => r.label === 'Owner approved the cost' && r.by === 'Olive Owner'));
  assert.ok(rows.some(r => r.label === 'Reminder sent to the owner' && r.by === null));
  assert.ok(rows.some(r => r.label === 'Escalated to client relations' && r.note === 'Cara'));
  // The owner sees their repair's history, without the team's escalation.
  await as(OWNER);
  const ownerRows = historyRows(historySchema.parse(await read('history', boiler.workId)));
  assert.ok(ownerRows.some(r => r.label === 'Owner approved the cost'));
  assert.ok(!ownerRows.some(r => r.label === 'Escalated to client relations'));
  for (const who of [CLEANER, ACCOUNTS, BEN]) {
    await as(who);
    await assert.rejects(read('history', boiler.workId), /Work not found/);
  }
  await as(ADMIN);
  assert.ok(historyRows(historySchema.parse(await read('history', journeyWork))).some(r => r.label === 'Estimate reminder sent to the owner'));
  await assert.rejects(read('nothing'), /Unknown oversight section/);
});
