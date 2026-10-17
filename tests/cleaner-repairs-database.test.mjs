import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Cleaners report repairs themselves (20261023100000), against the real database functions. A cleaner reports what is
// broken from a clean they are assigned to, at a property they clean, and it becomes the same repair the team would
// make, entering the same flow (the team's route, the contractor's estimate, management's review, the owner's limit).
// The repair says who raised it and when; owners and contractors never get that. The cleaner follows the repairs they
// raised with a plain status and nothing about money, the owner or the contractor. Nobody else gains anything.
const MIGRATION = 'supabase/migrations/20261023100000_cleaner_repairs.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); });

const roles = ['super_admin', 'admin', 'stays', 'cleans', 'cleans', 'cleaning_manager', 'client', 'ready', 'accounts'];
const [SUPER, ADMIN, STAYS, CLEANER, OTHER_CLEANER, MANAGER, OWNER, READY, ACCOUNTS] = roles.map((_, i) => i);
const names = ['Alex Super', 'Admin Person', 'Sam Stays', 'Cara Cleaner', 'Ollie Cleaner', 'Mia Manager', 'Olivia Owner', 'Andy Plumber', 'Acc Ounts'];
const users = roles.map((_, i) => `7e000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('7e00', '7f00');
const READY_MODULES = ['ready-schedule', 'safety-maintenance', 'purchase-order', 'maintenance-reporting', 'property-furnishing-board', 'new-property-inspection-board', 'routine-bin-garden-board'];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `cleaner-repairs${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  // Cleaners have the cleaners' usual tools only, contractors the Ready tools, everyone else every tool.
  if (roles[i] === 'cleans') await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule'),($1,'cleaner-performance')", [users[i]]);
  else if (roles[i] === 'ready') await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,unnest($2::text[])', [users[i], READY_MODULES]);
  else await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
let current = null;
async function as(i) { current = i; await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(i === 'service' ? {} : { sub: users[i], session_id: session(i) })]); await db.exec(i === 'service' ? 'set role service_role' : 'set role authenticated'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const owner = async (sql, args = []) => { await db.exec('reset role'); return (await db.query(sql, args)).rows; };
const call = async (fn, input) => (await db.query(`select public.${fn}($1::jsonb) result`, [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const action = input => call('workspace_operations_action', input);
const update = (w, step, data, requestId) => action({ action: 'updateOperation', workId: w.workId, version: w.version, step, data, ...(requestId ? { requestId } : {}) });
const mine = async (i = CLEANER) => { await as(i); return (await db.query('select public.workspace_cleaner_repairs() r')).rows[0].r; };
const fresh = async w => { const back = current; await as(STAYS); const r = (await db.query('select public.workspace_operation_read($1) r', [w.workId])).rows[0].r; if (back !== null) await as(back); return r; };
const told = async (user, work, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and o.work_id=$2 and a.event_type=$3', [users[user], work, event]))[0].n;
const repairRow = async id => (await owner('select w.module_id,w.title,w.client_visible,w.created_by,w.status,d.kind,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=$1', [id]))[0];
const today = (await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
const plus = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const MONEY = /Minor$|quote|estimate|owner|assignedReady|previousReady|contractor|autoApprov|management|review|budget|cost/i;

await as(SUPER);
const saveProperty = async name => (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name, address: 'Test address', region: 'Edinburgh', bedrooms: 2 })])).rows[0].id;
const home = await saveProperty('Harbour flat'), other = await saveProperty('Other flat'), team = await saveProperty('Team flat');
for (const [prop, i, kind] of [[home, CLEANER, 'cleaner'], [home, OTHER_CLEANER, 'cleaner'], [home, MANAGER, 'cleaning_manager'], [home, STAYS, 'staff'], [home, READY, 'staff'], [home, OWNER, 'client'],
  [other, OTHER_CLEANER, 'cleaner'], [other, MANAGER, 'cleaning_manager'], [other, STAYS, 'staff'], [team, STAYS, 'staff'], [team, READY, 'staff'], [team, OWNER, 'client']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [prop, users[i], kind]);
// The owner's limit for both repair homes: 100 pounds, set in Limit Changer.
await call('workspace_repair_limits_action', { action: 'setRepairLimit', propertyIds: [home, team], limitMinor: 10000, fullPermission: false });

// A clean at a property, assigned to a cleaner, as the cleaner reads it.
async function cleanFor(cleaner, prop = home) {
  await as(MANAGER);
  const created = await action({ action: 'createOperation', propertyId: prop, kind: 'cleaning', data: { dueOn: today, checklist: ['Kitchen', 'Bathroom'] } });
  await db.query('select public.workspace_assign_work($1,$2,$3)', [created.workId, created.version, users[cleaner]]);
  await as(cleaner);
  return (await db.query('select public.workspace_operations_read($1) r', [prop])).rows[0].r.find(w => w.workId === created.workId);
}
const reportFrom = (clean, data, requestId) => update(clean, 'reportCleanProblem', { urgent: false, repairType: 'leak', issue: 'Kitchen tap leaking under the sink', ...data }, requestId);
const repairOf = clean => clean.data.problems.at(-1).repairWorkId;

test('the migration is safe to run twice, each patch is in once, and it follows the conventions', async () => {
  const fns = ['private.workspace_operations_action(jsonb)', 'private.workspace_operation_view(uuid)', 'private.workspace_cleaner_repair_entry(uuid,uuid,jsonb,jsonb)', 'private.workspace_cleaner_repairs()', 'public.workspace_cleaner_repairs()'];
  const prints = async () => (await owner("select f, md5(replace(p.prosrc,chr(13),'')) h from unnest($1::text[]) f join pg_proc p on p.oid=f::regprocedure order by f", [fns])).map(r => r.f + ' ' + r.h).join('\n');
  const before = await prints();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.equal(await prints(), before, 'the fingerprints do not change on a second run');
  const def = async f => (await owner('select pg_get_functiondef($1::regprocedure) d', [f]))[0].d;
  const operations = await def(fns[0]), view = await def(fns[1]);
  for (const sentinel of ['cleaner repairs keys', 'cleaner repairs route', 'cleaner repairs problem']) assert.equal(operations.split(`/* ${sentinel}: 20261023100000 */`).length - 1, 1, sentinel);
  assert.equal(operations.split("elsif kind='cleaning' and step='reportCleanProblem'").length - 1, 1);
  assert.equal(view.split("-'raisedBy'").length - 1, 1);
  const text = await fs.readFile(MIGRATION, 'utf8');
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b|\bdelete\s+from\b/i, 'no DROP, no DELETE');
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.match(text, /\r\n/, 'CRLF');
  assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, 'every line ends CRLF');
  assert.match(code, /revoke all on function private\.workspace_cleaner_repair_entry\(uuid,uuid,jsonb,jsonb\) from public,anon,authenticated,service_role;/);
  assert.match(code, /revoke all on function private\.workspace_cleaner_repairs\(\),public\.workspace_cleaner_repairs\(\) from public,anon,authenticated,service_role;/);
  assert.match(code, /grant execute on function private\.workspace_cleaner_repairs\(\),public\.workspace_cleaner_repairs\(\) to authenticated;/);
  assert.equal(code.match(/grant execute/gi).length, 1, 'that is the only grant');
  const meta = await owner("select p.oid::regprocedure::text f,p.prosecdef d,p.proconfig c from pg_proc p where p.oid=any($1::text[]::regprocedure[]) order by 1", [fns.slice(2)]);
  for (const m of meta) assert.deepEqual(m.c, ['search_path=""'], m.f + " sets search_path=''");
  assert.deepEqual(meta.map(m => [m.f, m.d]), [['private.workspace_cleaner_repair_entry(uuid,uuid,jsonb,jsonb)', true], ['private.workspace_cleaner_repairs()', true], ['workspace_cleaner_repairs()', false]], 'private definer, public invoker');
  // The helper is internal: nobody signed in calls it, and anon cannot call the list.
  await as(CLEANER);
  await assert.rejects(db.query("select private.workspace_cleaner_repair_entry($1,$1,'{}'::jsonb,'{}'::jsonb)", [home]), /permission denied/);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_cleaner_repairs()'), /permission denied/);
});

test('a cleaner raises a repair from their clean: the same repair the team makes, marked as theirs', async () => {
  let clean = await cleanFor(CLEANER);
  const requestId = crypto.randomUUID();
  clean = await reportFrom(clean, { issue: 'Bathroom light fitting sparking', repairType: 'electrics', hazard: true }, requestId);
  assert.equal(clean.data.phase, 'assigned', 'the clean carries on');
  const [problem] = clean.data.problems;
  assert.deepEqual([problem.issue, problem.repairType, problem.urgent, problem.hazard], ['Bathroom light fitting sparking', 'electrics', true, true], 'a hazard is always urgent');
  const repair = await repairRow(problem.repairWorkId);
  // The team's own repair, for comparison: same module, title, visibility and starting point.
  await as(STAYS);
  const ours = await action({ action: 'createOperation', propertyId: home, kind: 'maintenance', data: { issue: 'Bathroom light fitting sparking', estimatedCostMinor: 0, hazard: true, urgent: true, repairType: 'electrics' } });
  const theirs = await repairRow(ours.workId);
  for (const key of ['module_id', 'title', 'client_visible', 'status', 'kind']) assert.equal(repair[key], theirs[key], key);
  for (const key of ['phase', 'resumePhase', 'estimatedCostMinor', 'hazard', 'urgent', 'repairType', 'workStatus', 'warrantyRequired']) assert.deepEqual(repair.data[key], theirs.data[key], key);
  assert.equal(repair.data.phase, 'triage');
  assert.equal(repair.created_by, users[CLEANER]);
  assert.equal(repair.data.reportedBy, users[CLEANER]); assert.equal(repair.data.reportedFromClean, clean.workId);
  assert.deepEqual({ ...repair.data.raisedBy, at: undefined }, { role: 'cleans', userId: users[CLEANER], name: 'Cara Cleaner', at: undefined, cleanWorkId: clean.workId });
  assert.ok(Math.abs(Date.parse(repair.data.raisedBy.at) - Date.now()) < 60_000, 'when');
  // The same request again gives the same answer and makes nothing new (the receipt).
  await as(CLEANER);
  const again = await reportFrom({ ...clean, version: clean.version - 1 }, { issue: 'Bathroom light fitting sparking', repairType: 'electrics', hazard: true }, requestId);
  assert.deepEqual(again, clean);
  assert.equal((await owner("select count(*)::int n from private.workspace_domain_details where kind='maintenance' and data->>'reportedFromClean'=$1", [clean.workId]))[0].n, 1);
  // Relations and management hear about it the way they hear about a repair the team reports.
  for (const who of [STAYS, ADMIN, SUPER]) assert.equal(await told(who, problem.repairWorkId, 'handover.created'), 1, roles[who] + ' is told');
  for (const who of [READY, ACCOUNTS, OTHER_CLEANER, CLEANER]) assert.equal(await told(who, problem.repairWorkId, 'handover.created'), 0, roles[who] + ' is not');
  // Stays see who raised it; the owner and the contractor never do.
  await as(STAYS);
  assert.equal((await fresh({ workId: problem.repairWorkId })).data.raisedBy.name, 'Cara Cleaner');
  await as(OWNER);
  const forOwner = (await db.query('select public.workspace_operation_read($1) r', [problem.repairWorkId])).rows[0].r;
  assert.equal('raisedBy' in forOwner.data, false, 'not for the owner'); assert.equal('reportedBy' in forOwner.data, false);
  // Bad input is refused.
  await as(CLEANER);
  await assert.rejects(reportFrom(clean, { hazard: 'yes' }), /safety hazard/);
  await assert.rejects(reportFrom(clean, { estimatedCostMinor: 5000 }), /Unknown or oversized workflow input/, 'no cost from a cleaner');
});

test('only on the cleaner’s own clean at a property they clean; every other route stays shut', async () => {
  const theirs = await cleanFor(CLEANER);
  await as(OTHER_CLEANER);
  await assert.rejects(reportFrom(theirs, {}), /access denied/, 'not on another cleaner’s clean');
  const elsewhere = await cleanFor(OTHER_CLEANER, other);
  await as(CLEANER);
  await assert.rejects(reportFrom(elsewhere, {}), /access denied/, 'not at a property they do not clean');
  await assert.rejects(action({ action: 'createOperation', propertyId: home, kind: 'maintenance', data: { issue: 'Kitchen tap leaking', estimatedCostMinor: 0, hazard: false } }), /denied/, 'the team’s own repair form stays closed to cleaners');
  // Taken off the property: no more reports from its cleans, and its repairs leave their list.
  let clean = await cleanFor(CLEANER);
  clean = await reportFrom(clean, { issue: 'Loose stair rail on the landing', repairType: 'damage' });
  assert.ok((await mine()).some(r => r.workId === repairOf(clean)));
  await as(SUPER); await db.query('select public.workspace_unassign_property($1,$2)', [home, users[CLEANER]]);
  await as(CLEANER);
  await assert.rejects(reportFrom(clean, {}), /access denied/);
  assert.equal((await mine()).some(r => r.workId === repairOf(clean)), false);
  await as(SUPER); await db.query('select public.workspace_assign_property($1,$2,$3)', [home, users[CLEANER], 'cleaner']);
  // The others gain nothing: nobody but a cleaner has the list, and nobody but the cleaner on the clean reports from it.
  for (const who of [SUPER, ADMIN, STAYS, MANAGER, OWNER, READY, ACCOUNTS]) {
    await assert.rejects(mine(who), /Only cleaners/, roles[who] + ' has no cleaner list');
    await as(who);
    await assert.rejects(reportFrom(theirs, {}), /denied|Only the cleaner/i, roles[who] + ' cannot report from the clean');
  }
});

test('the downstream flow is the team’s: the contractor’s estimate, management’s review and the owner’s limit', async () => {
  // One repair raised by the cleaner, one by Stays, walked through the same steps.
  const walk = async (raise, quoteMinor) => {
    const first = await raise();
    const phases = [first.data.phase];
    await as(STAYS);
    let w = await update(await fresh(first), 'referReady', { troubleshooting: 'Checked the tap, the washer has gone', guestUpdate: 'A plumber is being arranged', readyUserId: users[READY] });
    phases.push(w.data.phase);
    await as(READY);
    w = await update(w, 'reviseQuote', { quoteMinor, reason: 'New tap cartridge and fitting' });
    phases.push(w.data.phase);
    await as(ADMIN);
    w = await update(await fresh(w), 'reviewDone', {});
    phases.push(w.data.phase);
    return { w, phases };
  };
  const byCleaner = async () => { const c = await reportFrom(await cleanFor(CLEANER), { issue: 'Kitchen tap dripping all day' }); return fresh({ workId: repairOf(c) }); };
  const byStays = async () => { await as(STAYS); return action({ action: 'createOperation', propertyId: home, kind: 'maintenance', data: { issue: 'Kitchen tap dripping all day', estimatedCostMinor: 0, hazard: false, repairType: 'leak', urgent: false } }); };
  // Over the owner's 100 pound limit: the owner is asked, for both.
  const over = [await walk(byCleaner, 15000), await walk(byStays, 15000)];
  assert.deepEqual(over[0].phases, ['triage', 'referred', 'team_review', 'owner_approval']);
  assert.deepEqual(over[0].phases, over[1].phases, 'the same steps as a repair the team reported');
  for (const r of over) assert.equal(await told(OWNER, r.w.workId, 'operations.updateOperation.reviewDone'), 1, 'the owner is asked');
  // Within it: approved straight away, and the contractor is told to book, for both.
  const within = [await walk(byCleaner, 6000), await walk(byStays, 6000)];
  assert.deepEqual(within[0].phases, ['triage', 'referred', 'team_review', 'referred']);
  assert.deepEqual(within[0].phases, within[1].phases);
  for (const r of within) {
    assert.equal(r.w.data.autoApprovedMinor, 6000); assert.equal(r.w.data.autoApprovalLimitMinor, 10000); assert.ok(r.w.data.bookingApprovedAt);
    assert.equal(await told(READY, r.w.workId, 'operations.updateOperation.approvedToBook'), 1);
  }
  // The contractor sees the cleaner's repair but never who raised it.
  await as(READY);
  const forReady = (await db.query('select public.workspace_operation_read($1) r', [within[0].w.workId])).rows[0].r;
  assert.equal('raisedBy' in forReady.data, false, 'not for the contractor');
  assert.equal(forReady.data.reportedFromClean !== undefined, true, 'what they saw before is unchanged');
});

test('the cleaner follows what they raised: a plain status, never money, the owner or the contractor', async () => {
  let clean = await cleanFor(CLEANER);
  clean = await reportFrom(clean, { issue: 'Shower drains very slowly', repairType: 'toilet_drain', urgent: true });
  const id = repairOf(clean);
  const row = async () => (await mine()).find(r => r.workId === id);
  let r = await row();
  assert.deepEqual(Object.keys(r).sort(), ['cleanWorkId', 'hazard', 'issue', 'propertyId', 'propertyName', 'repairType', 'reportedAt', 'status', 'urgent', 'visitOn', 'workId']);
  assert.deepEqual([r.status, r.issue, r.propertyName, r.urgent, r.hazard, r.cleanWorkId, r.visitOn], ['reported', 'Shower drains very slowly', 'Harbour flat', true, false, clean.workId, null]);
  await as(STAYS);
  let w = await update(await fresh({ workId: id }), 'referReady', { troubleshooting: 'Plunged it, still slow', guestUpdate: 'A plumber is coming', readyUserId: users[READY] });
  assert.equal((await row()).status, 'contractor');
  await as(READY); w = await update(w, 'reviseQuote', { quoteMinor: 25000, reason: 'Drain rods and a new trap' });
  r = await row();
  assert.equal(r.status, 'approval');
  assert.equal(Object.keys(r).some(k => MONEY.test(k)), false, 'no money, owner or contractor keys');
  assert.equal(JSON.stringify(r).includes('25000'), false, 'not the quote');
  assert.equal(JSON.stringify(r).includes('Andy'), false, 'not the contractor');
  await as(ADMIN); w = await update(await fresh(w), 'reviewDone', {});
  await as(OWNER); w = await update(w, 'approveBudget', { consent: true });
  assert.equal((await row()).status, 'contractor', 'approved, back with the contractor');
  await as(READY); await update(w, 'bookRepair', { repairOn: plus(2), visitFrom: '09:00', visitTo: '11:00', guestUpdate: 'Plumber booked' });
  r = await row();
  assert.deepEqual([r.status, r.visitOn], ['booked', plus(2)]);
  assert.equal(JSON.stringify(await mine()).includes('Olivia'), false, 'never the owner');
  // A second one sorted without a visit reads as fixed; repairs other people raised are not on the list.
  clean = await reportFrom((await cleanFor(CLEANER)), { issue: 'Wi-Fi router lights all off', repairType: 'wifi' });
  await as(STAYS); await update(await fresh({ workId: repairOf(clean) }), 'resolveRepair', { resolution: 'Router was unplugged, plugged back in' });
  assert.equal((await row()).status, 'booked');
  assert.equal((await mine()).find(x => x.workId === repairOf(clean)).status, 'fixed');
  const list = await mine();
  assert.ok(list.every(x => x.propertyId === home));
  assert.equal((await mine(OTHER_CLEANER)).some(x => list.some(y => y.workId === x.workId)), false, 'each cleaner sees only their own');
  assert.equal((await owner("select count(*)::int n from private.workspace_domain_details where kind='maintenance' and data->>'reportedBy'=$1", [users[STAYS]]))[0].n > 0, true);
  assert.equal(list.some(x => x.cleanWorkId === null), false, 'repairs the team raised are not on it');
});
