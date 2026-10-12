import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Repairs and visit forms (20261012200000): a repair that sits in triage can be resolved by troubleshooting,
// and a routine visit cannot go to review or be completed until its visit form is recorded. The form answers
// every checklist item once, in order. Owners, cleaners and Accounts are refused.
const NAME = '20261012200000_repairs_visit_forms';
const dir = 'supabase/migrations/';
const files = await fs.readdir(dir);
const migrationFile = files.includes(NAME + '.sql') ? NAME + '.sql' : NAME + '.sql.draft';
const migrationText = await fs.readFile(dir + migrationFile, 'utf8');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of files.filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile(dir + file, 'utf8'));
// While the migration is still a draft it is applied last, on top of everything else.
if (migrationFile.endsWith('.draft')) await db.exec(migrationText);
after(async () => { await db.close(); });

const roles = ['super_admin', 'admin', 'stays', 'stays', 'ready', 'cleans', 'client', 'accounts', 'stays'];
const names = ['Person Super', 'Person Admin', 'Person Stays', 'Person Second Stays', 'Person Ready', 'Person Cleaner', 'Client Olive', 'Person Accounts', 'Person Roaming'];
const users = roles.map((_, i) => `e8000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, STAYS2, READY, CLEANER, OWNER, ACCOUNTS, ROAMING] = roles.map((_, i) => i);
const session = i => users[i].replace('e800', 'e900');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `visitforms${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
let current = null;
async function as(i) {
  current = i;
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const operation = (input, requestId = crypto.randomUUID()) => rpc('workspace_operations_action', [{ requestId, ...input }]);
const create = (property, kind, data) => operation({ action: 'createOperation', propertyId: property, kind, data });
const step = (w, name, data, requestId) => operation({ action: 'updateOperation', workId: w.workId, version: w.version, step: name, data }, requestId);
const teams = (input, requestId = crypto.randomUUID()) => rpc('workspace_teams_action', [{ requestId, ...input }]);
// Database-level queries for set-up and checks; whoever was signed in is signed in again afterwards.
const sql = async (text, args = []) => { const who = current; await asDb(); const rows = (await db.query(text, args)).rows; if (who !== null) await as(who); return rows; };
const notified = async (i, workId, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type=$3', [users[i], workId, event]))[0].n;
const versionOf = async workId => (await sql('select version from public.workspace_work_items where id=$1', [workId]))[0].version;
const detail = async workId => (await sql('select data from private.workspace_domain_details where work_id=$1', [workId]))[0].data;
const statusOf = async workId => (await sql('select status from public.workspace_work_items where id=$1', [workId]))[0].status;
const move = async (who, workId, status, note = 'Moving the visit on') => { await as(who); return rpc('workspace_transition_work', [workId, await versionOf(workId), status, note, crypto.randomUUID()]); };
const month = (await sql("select to_char(current_date,'YYYY-MM') m"))[0].m;
const nextDue = (await sql("select ((date_trunc('month',current_date)+interval '1 month')::date+4)::text d"))[0].d;

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Visit flat', address: '4 Leith Walk, Edinburgh' }]);
const FAR = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Far cottage', address: '9 Harbour Road, Oban' }]);
for (const who of [STAYS, STAYS2, READY]) await rpc('workspace_assign_property', [HOME, users[who], 'staff']);
await rpc('workspace_assign_property', [HOME, users[CLEANER], 'cleaner']);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);

const definition = async name => (await sql('select pg_get_functiondef($1::regprocedure) def', [name]))[0].def;
const occurrences = (text, needle) => (text.length - text.replaceAll(needle, '').length) / needle.length;

test('the patches took once, keep their anchors, and the migration is written for the calm house rules', async () => {
  const ops = await definition('private.workspace_operations_action(jsonb)');
  assert.equal(occurrences(ops, "elsif kind='maintenance' and step='referReady' then"), 1, 'the referReady anchor is kept once');
  assert.equal(occurrences(ops, "step='resolveRepair'"), 1);
  assert.ok(ops.indexOf("step='resolveRepair'") < ops.indexOf("step='referReady'"), 'resolveRepair comes before referReady');
  const team = await definition('private.workspace_teams_action(jsonb)');
  const hub = "if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;";
  assert.equal(occurrences(team, hub), 1, 'the hub route anchor is kept once');
  assert.equal(occurrences(team, 'private.workspace_visit_form_action(input)'), 1);
  assert.ok(team.indexOf(hub) < team.indexOf('private.workspace_visit_form_action(input)'), 'the new route is appended after the anchor');
  assert.ok(!migrationText.includes(String.fromCharCode(0x2014)), 'no em dashes');
});

test('the assumptions are single immutable functions with the three visit lists', async () => {
  const [flags] = await sql("select provolatile v, private.workspace_visit_form_required() r from pg_proc where oid='private.workspace_visit_form_required()'::regprocedure");
  assert.equal(flags.v, 'i');
  assert.equal(flags.r, true);
  const [list] = await sql("select provolatile v from pg_proc where oid='private.workspace_visit_checklist(text)'::regprocedure");
  assert.equal(list.v, 'i');
  const counts = (await sql("select private.workspace_visit_checklist('routine') a, private.workspace_visit_checklist('garden') b, private.workspace_visit_checklist('bins') c, private.workspace_visit_checklist('anything else') d"))[0];
  assert.equal(counts.a.length, 6);
  assert.equal(counts.b.length, 4);
  assert.equal(counts.c.length, 4);
  assert.deepEqual(counts.d, counts.a, 'an unknown type gets the routine list');
});

// ------------------------------------------------------------------------------------------ B5, resolved repairs

test('a repair with no estimate sits in triage and Stays resolve it by troubleshooting', async () => {
  await as(STAYS);
  const repair = await create(HOME, 'maintenance', { issue: 'Radiator cold in the hall', estimatedCostMinor: 0, hazard: false, repairType: 'heating' });
  assert.equal(repair.data.phase, 'triage');
  assert.equal(repair.status, 'waiting');
  // Nobody but Stays or management can resolve it, and the text has to say what was done.
  await as(CLEANER); await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Bled the radiator and it is warm' }), /Work access denied/);
  await as(OWNER); await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Bled the radiator and it is warm' }), /Stays or management access/);
  await as(ACCOUNTS); await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Bled the radiator and it is warm' }), /access denied|Stays or management access/i);
  await as(READY); await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Bled the radiator and it is warm' }), /access denied|Stays or management access/i);
  await as(ROAMING); await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Bled the radiator and it is warm' }), /access denied/i);
  await as(STAYS);
  await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Done' }), /resolution/);
  await assert.rejects(step(repair, 'resolveRepair', { resolution: 'x'.repeat(2001) }), /resolution/);
  await assert.rejects(step(repair, 'resolveRepair', {}), /Invalid field resolution/);
  await assert.rejects(step(repair, 'resolveRepair', { resolution: 'Bled the radiator and it is warm', cost: 5 }), /Unknown or oversized/);
  assert.equal(await statusOf(repair.workId), 'waiting', 'every refusal left the repair untouched');
  const requestId = crypto.randomUUID();
  const resolved = await step(repair, 'resolveRepair', { resolution: '  Bled the radiator and the hall is warm again  ' }, requestId);
  assert.equal(resolved.status, 'completed');
  assert.equal(resolved.data.phase, 'resolved');
  assert.equal(resolved.data.resolution, 'Bled the radiator and the hall is warm again');
  assert.equal(resolved.data.workStatus, 'completed');
  assert.equal(resolved.data.resolvedBy, users[STAYS]);
  assert.ok(resolved.data.resolvedAt);
  const replay = await step(repair, 'resolveRepair', { resolution: '  Bled the radiator and the hall is warm again  ' }, requestId);
  assert.equal(replay.version, resolved.version, 'the same request replays');
  await assert.rejects(step(resolved, 'resolveRepair', { resolution: 'Resolved a second time' }), /closed/);
  // Told: the other Stays on the property and the owner, not Ready, the cleaner, someone elsewhere, or the person who did it.
  assert.equal(await notified(STAYS2, repair.workId, 'operations.updateOperation.resolveRepair'), 1);
  assert.equal(await notified(OWNER, repair.workId, 'operations.updateOperation.resolveRepair'), 1);
  assert.equal(await notified(READY, repair.workId, 'operations.updateOperation.resolveRepair'), 0);
  assert.equal(await notified(CLEANER, repair.workId, 'operations.updateOperation.resolveRepair'), 0);
  assert.equal(await notified(ROAMING, repair.workId, 'operations.updateOperation.resolveRepair'), 0);
  assert.equal(await notified(STAYS, repair.workId, 'operations.updateOperation.resolveRepair'), 0);
  // History: the status change carries the resolution and the step is an activity event for the item.
  await as(ADMIN);
  const history = (await rpc('workspace_oversight_read', ['history', repair.workId])).entries;
  assert.ok(history.some(h => h.type === 'status' && h.to === 'completed' && h.note === 'Bled the radiator and the hall is warm again'));
  assert.ok(history.some(h => h.type === 'event' && h.event === 'operations.updateOperation.resolveRepair'));
  const events = await sql("select count(*)::int n from public.workspace_activity where work_id=$1 and event_type='operations.updateOperation.resolveRepair'", [repair.workId]);
  assert.equal(events[0].n, 1);
  // The owner sees it resolved.
  await as(OWNER);
  const seen = (await rpc('workspace_operations_read', [HOME])).find(w => w.workId === repair.workId);
  assert.equal(seen.data.phase, 'resolved');
});

test('the owner reports a repair and is told when it is resolved; management can resolve one too', async () => {
  await as(OWNER);
  const repair = await create(HOME, 'maintenance', { issue: 'Dripping tap in the bathroom', estimatedCostMinor: 0, hazard: false, repairType: 'leak' });
  assert.equal(repair.data.phase, 'triage');
  await as(ADMIN);
  const resolved = await step(repair, 'resolveRepair', { resolution: 'Tightened the washer, no more drip' });
  assert.equal(resolved.data.phase, 'resolved');
  assert.equal(await notified(OWNER, repair.workId, 'operations.updateOperation.resolveRepair'), 1);
  assert.equal(await notified(STAYS, repair.workId, 'operations.updateOperation.resolveRepair'), 1);
  assert.equal(await notified(ADMIN, repair.workId, 'operations.updateOperation.resolveRepair'), 0, 'not the person who resolved it');
});

test('only a repair in triage can be resolved: referred, booked, completed and owner-approval repairs are refused', async () => {
  await as(STAYS);
  const high = await create(HOME, 'maintenance', { issue: 'Roof slates slipped at the back', estimatedCostMinor: 90000, hazard: false, repairType: 'damage' });
  assert.equal(high.data.phase, 'owner_approval');
  await assert.rejects(step(high, 'resolveRepair', { resolution: 'Looked at it, it is fine now' }), /still in triage/);
  const repair = await create(HOME, 'maintenance', { issue: 'Boiler pressure keeps dropping', estimatedCostMinor: 0, hazard: false, repairType: 'heating' });
  // A higher quote after the first look sends it to the owner, so it is no longer in triage either.
  const requoted = await step(repair, 'reviseQuote', { quoteMinor: 45000, reason: 'The pump has failed and needs replacing' });
  assert.equal(requoted.data.phase, 'owner_approval');
  await assert.rejects(step(requoted, 'resolveRepair', { resolution: 'Looked at it, it is fine now' }), /still in triage/);
  // The normal path still works, and a referred, booked or finished repair cannot be resolved this way.
  const second = await create(HOME, 'maintenance', { issue: 'Front door sticks in the damp', estimatedCostMinor: 0, hazard: false, repairType: 'locks_access' });
  const referred = await step(second, 'referReady', { troubleshooting: 'Checked the hinges and the frame', guestUpdate: 'Handyman being arranged' });
  assert.equal(referred.data.phase, 'referred');
  await assert.rejects(step(referred, 'resolveRepair', { resolution: 'Looked at it, it is fine now' }), /still in triage/);
  await as(READY);
  const booked = await step(referred, 'bookRepair', { repairOn: (await sql('select current_date::text d'))[0].d, contractor: 'Leith Joinery', guestUpdate: 'Joiner arriving this afternoon' });
  assert.equal(booked.data.phase, 'booked');
  await as(STAYS);
  await assert.rejects(step(booked, 'resolveRepair', { resolution: 'Looked at it, it is fine now' }), /still in triage/);
  await as(READY);
  const done = await step(booked, 'completeRepair', { report: 'Planed the door and rehung it', actualCostMinor: 0, guestUpdate: 'The door now closes properly' });
  assert.equal(done.data.phase, 'completed');
  assert.equal(done.status, 'completed');
  await as(STAYS);
  await assert.rejects(step(done, 'resolveRepair', { resolution: 'Looked at it, it is fine now' }), /closed/);
});

// ------------------------------------------------------------------------------------------ B6, visit forms

async function visitFor(title, items, planModule = 'routine-bin-garden-board') {
  await as(READY);
  const plan = await teams({ action: 'saveRoutinePlan', propertyId: HOME, moduleId: planModule, title, checklist: items, frequency: 'monthly', dayOfMonth: 5, assigneeId: users[READY], active: true });
  const made = await teams({ action: 'generateRoutineVisits', period: month });
  const found = (await sql("select v.work_id from private.workspace_routine_visits v where v.plan_id=$1 and v.period_start=date_trunc('month',current_date)::date", [plan.id]))[0];
  assert.ok(found && made.created.includes(found.work_id), 'the plan made this month\'s visit');
  return { workId: found.work_id, planId: plan.id };
}
const answersFor = (items, overrides = {}) => items.map((item, i) => ({ item, done: overrides[i] ?? true }));
async function record(visit, extra = {}, requestId) {
  return teams({ action: 'recordVisitForm', workId: visit.workId, version: await versionOf(visit.workId), ...extra }, requestId);
}

const ITEMS = ['Bins out', 'Lawn cut', 'Gutters checked'];
let visit;

test('a routine visit cannot go to review or be completed without its form, but can be cancelled', async () => {
  visit = await visitFor('Bins and garden', ITEMS);
  await move(READY, visit.workId, 'in_progress');
  await assert.rejects(move(READY, visit.workId, 'in_review'), /visit form/);
  assert.equal(await statusOf(visit.workId), 'in_progress');
  // The gate is the table itself, so no other path gets round it.
  await assert.rejects(sql("update public.workspace_work_items set status='completed' where id=$1", [visit.workId]), /visit form/);
  await assert.rejects(sql("update public.workspace_work_items set status='in_review' where id=$1", [visit.workId]), /visit form/);
  assert.equal(await statusOf(visit.workId), 'in_progress');
  // Other updates to the visit, and a visit that is cancelled, are not held up by the gate.
  await sql("update public.workspace_work_items set due_on=due_on where id=$1", [visit.workId]);
  const cancelled = await visitFor('Cancelled check', ['Walk round']);
  await move(ADMIN, cancelled.workId, 'cancelled', 'Not needed this month');
  assert.equal(await statusOf(cancelled.workId), 'cancelled');
});

test('wrong, missing, extra and reordered answers are refused, and nothing is stored', async () => {
  const good = answersFor(ITEMS);
  const bad = [
    [good.slice(0, 2), /in order/],
    [[...good, { item: 'Roof', done: true }], /in order/],
    [[good[1], good[0], good[2]], /in order/],
    [[good[0], { item: 'Lawn mown', done: true }, good[2]], /in order/],
    [[good[0], { item: 'Lawn cut', done: 'yes' }, good[2]], /in order/],
    [[good[0], { item: 'Lawn cut' }, good[2]], /in order/],
    [[good[0], { item: 'Lawn cut', done: true, price: 3 }, good[2]], /in order/],
    [[good[0], { item: 'Lawn cut', done: true, note: 'x'.repeat(301) }, good[2]], /in order/],
    [[good[0], { item: 'Lawn cut', done: true, note: 7 }, good[2]], /in order/],
    [[good[0], 'Lawn cut', good[2]], /in order/],
    ['all done', /in order/],
    [null, /in order/]
  ];
  await as(READY);
  for (const [answers, message] of bad) await assert.rejects(record(visit, { answers, note: 'Visited today' }), message, JSON.stringify(answers).slice(0, 80));
  await assert.rejects(record(visit, { answers: good }), /up to 2000/, 'the general note is required');
  await assert.rejects(record(visit, { answers: good, note: 'y'.repeat(2001) }), /up to 2000/);
  await assert.rejects(record(visit, { answers: good, note: 'Visited today', colour: 'blue' }), /Unknown or oversized/);
  assert.equal((await detail(visit.workId)).visitForm, undefined);
});

test('the client, cleaners, Accounts and Stays on another property cannot record a form; stale versions and other kinds are refused', async () => {
  const answers = answersFor(ITEMS);
  for (const who of [OWNER, CLEANER, ACCOUNTS]) { await as(who); await assert.rejects(record(visit, { answers, note: 'Visited today' }), /Only the team/); }
  await as(ROAMING); await assert.rejects(record(visit, { answers, note: 'Visited today' }), /Work not found/);
  await as(READY);
  await assert.rejects(teams({ action: 'recordVisitForm', workId: visit.workId, version: (await versionOf(visit.workId)) - 1, answers, note: 'Visited today' }), /Changed by someone else/);
  await assert.rejects(teams({ action: 'recordVisitForm', workId: visit.workId, answers, note: 'Visited today' }), /Changed by someone else/);
  await assert.rejects(teams({ action: 'recordVisitForm', workId: crypto.randomUUID(), version: 1, answers, note: 'Visited today' }), /Work not found/);
  await as(STAYS);
  const repair = await create(HOME, 'maintenance', { issue: 'Window latch loose', estimatedCostMinor: 0, hazard: false, repairType: 'other' });
  await assert.rejects(record({ workId: repair.workId }, { answers, note: 'Visited today' }), /Only a routine visit/);
});

test('photos must be photos saved on this property', async () => {
  const pv = await visitFor('Photo check', ['Walk round']);
  const answers = answersFor(['Walk round']);
  await as(STAYS);
  const repair = await create(HOME, 'maintenance', { issue: 'Photographed scuff on the stairs', estimatedCostMinor: 0, hazard: false, repairType: 'damage' });
  const farWork = (await sql('select private.workspace_handover($1,$2,$3,$4,$5::jsonb) id', [FAR, 'stays-maintenance-reporting', 'Far repair', 'maintenance', JSON.stringify({ phase: 'triage' })]))[0].id;
  const photo = async (property, work, key) => (await sql("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'maintenance',$4,now()) returning id", [property, work, users[READY], 'visit-photo-' + key]))[0].id;
  const own = await photo(HOME, repair.workId, 'a');
  const far = await photo(FAR, farWork, 'b');
  await as(READY);
  for (const bad of [[far], [own, far], [crypto.randomUUID()], ['not an id'], [7], 'photo', Array.from({ length: 11 }, () => own)]) {
    await assert.rejects(record(pv, { answers, note: 'Visited today', photoIds: bad }), /photos|Add up to 10/i, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await detail(pv.workId)).visitForm, undefined);
  // Valid photos are kept once each.
  const stored = await record(pv, { answers, note: 'Walked round, all well', photoIds: [own, own] });
  assert.deepEqual(stored.data.visitForm.photoIds, [own]);
});

test('a valid form is stored, stamps last done and next due, and unlocks review and completion', async () => {
  await as(READY);
  const before = await versionOf(visit.workId);
  const answers = [{ item: 'Bins out', done: true }, { item: ' Lawn cut ', done: true, note: '  Front and back  ' }, { item: 'Gutters checked', done: false, note: 'Needs a ladder' }];
  const requestId = crypto.randomUUID();
  const stored = await teams({ action: 'recordVisitForm', workId: visit.workId, version: before, answers, note: '  Bins out, lawn cut, gutters left for next time  ' }, requestId);
  assert.equal(stored.version, before + 1, 'the visit moves on a version so stale screens refresh');
  const f = stored.data.visitForm;
  assert.deepEqual(f.answers, [{ item: 'Bins out', done: true }, { item: 'Lawn cut', done: true, note: 'Front and back' }, { item: 'Gutters checked', done: false, note: 'Needs a ladder' }]);
  assert.equal(f.note, 'Bins out, lawn cut, gutters left for next time');
  assert.equal(f.doneCount, 2);
  assert.equal(f.totalCount, 3);
  assert.equal(f.recordedBy, users[READY]);
  assert.ok(f.recordedAt);
  assert.ok(stored.data.lastDoneAt);
  assert.equal(stored.data.nextDueOn, nextDue, 'the next monthly visit falls due on the plan\'s day');
  assert.equal(stored.data.visitType, 'garden');
  assert.equal(stored.data.period, month);
  // The same request replays without moving the version; a different request with the same input is a new record.
  const replay = await teams({ action: 'recordVisitForm', workId: visit.workId, version: before, answers, note: '  Bins out, lawn cut, gutters left for next time  ' }, requestId);
  assert.equal(replay.version, stored.version);
  assert.equal(await versionOf(visit.workId), before + 1);
  await assert.rejects(teams({ action: 'recordVisitForm', workId: visit.workId, version: before, answers, note: 'A different note' }, requestId), /reused/);
  // The form can be corrected while the visit is open.
  const corrected = await record(visit, { answers: answersFor(ITEMS), note: 'Gutters done after all' });
  assert.equal(corrected.data.visitForm.doneCount, 3);
  // Now it can go on, and be approved and completed by someone else.
  await move(READY, visit.workId, 'in_review');
  assert.equal(await statusOf(visit.workId), 'in_review');
  await move(ADMIN, visit.workId, 'approved', 'Looks good');
  await move(ADMIN, visit.workId, 'completed', 'Visit done');
  assert.equal(await statusOf(visit.workId), 'completed');
  const done = await detail(visit.workId);
  assert.ok(done.lastDoneAt);
  assert.equal(done.nextDueOn, nextDue);
  await as(READY);
  await assert.rejects(record(visit, { answers: answersFor(ITEMS), note: 'Too late' }), /already closed/);
  const events = await sql("select count(*)::int n from public.workspace_activity where work_id=$1 and event_type='routine.visit_form_recorded'", [visit.workId]);
  assert.equal(events[0].n, 2);
});

test('a visit whose plan gave no checklist starts from its type: bins, garden or routine', async () => {
  const lists = {};
  for (const [key, title, module] of [['bins', 'Bin collection check', 'routine-bin-garden-board'], ['garden', 'Garden tidy', 'routine-bin-garden-board'], ['routine', 'Property check', 'safety-maintenance']]) {
    const id = (await sql('select private.workspace_handover($1,$2,$3,$4,$5::jsonb) id', [HOME, module, title, 'routine_visit', JSON.stringify({ period: month })]))[0].id;
    lists[key] = id;
  }
  await as(READY);
  const expected = async type => (await sql('select private.workspace_visit_checklist($1) l', [type]))[0].l;
  for (const key of ['bins', 'garden', 'routine']) {
    const items = await expected(key);
    await assert.rejects(record({ workId: lists[key] }, { answers: answersFor(items.slice(1)), note: 'Visited today' }), /in order/);
    const stored = await record({ workId: lists[key] }, { answers: answersFor(items), note: 'Visited today' });
    assert.equal(stored.data.visitType, key);
    assert.deepEqual(stored.data.checklist, items, 'the list used is kept with the visit');
    assert.equal(stored.data.visitForm.totalCount, items.length);
    assert.equal(stored.data.nextDueOn, null, 'a visit with no plan has no next due date');
    await move(READY, lists[key], 'in_progress');
    await move(READY, lists[key], 'in_review');
  }
});

test('the migration is safe to run twice and the anchors are still there once afterwards', async () => {
  await asDb();
  await db.exec(migrationText);
  await db.exec(migrationText);
  const ops = await definition('private.workspace_operations_action(jsonb)');
  assert.equal(occurrences(ops, "elsif kind='maintenance' and step='referReady' then"), 1);
  assert.equal(occurrences(ops, "step='resolveRepair'"), 1);
  const team = await definition('private.workspace_teams_action(jsonb)');
  assert.equal(occurrences(team, 'private.workspace_visit_form_action(input)'), 1);
  const triggers = await sql("select count(*)::int n from pg_trigger where tgname='visit_form_guard' and tgrelid='public.workspace_work_items'::regclass");
  assert.equal(triggers[0].n, 1);
  // And the behaviour is unchanged.
  await as(STAYS);
  const repair = await create(HOME, 'maintenance', { issue: 'Smoke alarm chirping', estimatedCostMinor: 0, hazard: false, repairType: 'electrics' });
  const resolved = await step(repair, 'resolveRepair', { resolution: 'Changed the battery in the alarm' });
  assert.equal(resolved.data.phase, 'resolved');
});
