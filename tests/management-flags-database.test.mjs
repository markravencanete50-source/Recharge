import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Management flags: anyone on the team flags work they can see, a hub record, or a free-standing
// request; one open flag per item; only management resolves or declines (with a reason); the raiser
// can withdraw; admins hear about each flag and the raiser hears the decision; owners are refused.
const NAME = '20261012140000_management_flags';
const DIR = 'supabase/migrations/';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir(DIR)).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile(DIR + file, 'utf8'));
// While the migration is a draft, it is applied after everything else (rule R1).
const own = files.includes(NAME + '.sql') ? NAME + '.sql' : NAME + '.sql.draft';
const migration = await fs.readFile(DIR + own, 'utf8');
if (!files.includes(NAME + '.sql')) await db.exec(migration);

const roles = ['super_admin', 'admin', 'stays', 'stays', 'cleans', 'ready', 'client'];
const names = ['Admin', 'Mia Manager', 'Sam Stays', 'Olive Other', 'Cara Cleaner', 'Rory Ready', 'Owen Owner'];
const [ADMIN, MANAGER, STAYS, OTHER, CLEANER, READY, CLIENT] = roles.map((_, i) => i);
const users = roles.map((_, i) => `86000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('8600', '8700');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `flags${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(async () => { await db.close(); });
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const act = async input => (await db.query('select public.workspace_teams_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const read = async () => (await db.query("select public.workspace_teams_read('flags',null,null,null,null) result")).rows[0].result;
const flag = input => act({ action: 'flagForManagement', ...input });
const notified = async (i, event, workId) => (await owner(`select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  where o.user_id=$1 and a.event_type=$2 and ($3::uuid is null or a.work_id=$3)`, [users[i], event, workId ?? null]))[0].n;
const definition = async fn => (await owner('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d;
const occurrences = (text, part) => text.split(part).length - 1;

await as(ADMIN);
const property = (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name: 'Flag flat', address: '3 Flag Street, Leith', region: 'Edinburgh', bedrooms: 2 })])).rows[0].id;
for (const [i, assignment] of [[STAYS, 'staff'], [READY, 'staff'], [CLIENT, 'client'], [CLEANER, 'cleaner']]) await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[i], assignment]);
const todo = await act({ action: 'saveHubItem', kind: 'todo', title: 'Restock the cleaning cupboard', assigneeId: users[CLEANER] });
await as(STAYS);
const purchase = (await db.query('select public.workspace_operations_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), action: 'createOperation', propertyId: property, kind: 'purchase', data: { requirements: 'A new kettle, the old one leaks', budgetMinor: 4000 } })])).rows[0].result;
const workRow = async () => (await owner('select status,version,updated_at from public.workspace_work_items where id=$1', [purchase.workId]))[0];

let workFlag;
test('any team role flags what it can see, never what it cannot, and only once while open', async () => {
  const before = await workRow();
  await as(STAYS);
  workFlag = await flag({ source: 'work', workId: purchase.workId, title: 'Kettle over budget', reason: 'The only kettle in stock is 45 pounds', amountMinor: 4500 });
  assert.equal(workFlag.status, 'open'); assert.equal(workFlag.source, 'work'); assert.equal(workFlag.raisedByName, 'Sam Stays'); assert.equal(workFlag.mine, true);
  assert.equal(workFlag.propertyId, property); assert.equal(workFlag.propertyAddress, '3 Flag Street, Leith'); assert.equal(workFlag.workKind, 'purchase'); assert.equal(workFlag.amountMinor, 4500);
  await as(READY);
  await assert.rejects(flag({ source: 'work', workId: purchase.workId, title: 'Kettle again', reason: 'Raising the same thing twice' }), /Already flagged/);
  await as(OTHER);
  await assert.rejects(flag({ source: 'work', workId: purchase.workId, title: 'Not my property', reason: 'I am not on this property team' }), /Work not found/);
  await as(CLEANER);
  await assert.rejects(flag({ source: 'work', workId: purchase.workId, title: 'Not my clean', reason: 'This work is not assigned to me' }), /Work not found/);
  const hubFlag = await flag({ source: 'hub', hubItemId: todo.id, title: 'Cupboard key missing', reason: 'Nobody has the key to the cupboard' });
  assert.equal(hubFlag.hubItemId, todo.id); assert.equal(hubFlag.workId, null); assert.equal(hubFlag.hubTitle, 'Restock the cleaning cupboard');
  await assert.rejects(flag({ source: 'hub', hubItemId: todo.id, title: 'Key again', reason: 'Raising the same thing twice' }), /Already flagged/);
  await as(OTHER);
  await assert.rejects(flag({ source: 'hub', hubItemId: todo.id, title: 'Not my to-do', reason: 'This is someone else\'s to-do' }), /Record not found/);
  // The payload must match its source, and a person cannot raise an automatic clean form flag.
  for (const bad of [{ source: 'work' }, { source: 'request', workId: purchase.workId }, { source: 'hub', workId: purchase.workId }, { source: 'clean_form', workId: purchase.workId }, {}])
    await assert.rejects(flag({ title: 'Bad shape', reason: 'The payload does not match', ...bad }), /Choose what to flag/, JSON.stringify(bad));
  await assert.rejects(flag({ source: 'request', title: 'Short', reason: 'no' }), /Say why/);
  await assert.rejects(flag({ source: 'request', title: 'x', reason: 'A proper reason' }), /short title/);
  await assert.rejects(flag({ source: 'request', title: 'Extra key', reason: 'A proper reason', propertyId: property }), /Unknown or oversized/);
  // Admins hear about each flag; the activity row carries the work so its tracker row updates.
  for (const i of [ADMIN, MANAGER]) assert.equal(await notified(i, 'management.flag_raised', purchase.workId), 1, names[i]);
  assert.equal(await notified(STAYS, 'management.flag_raised', purchase.workId), 0, 'never the person who raised it');
  assert.equal(await notified(ADMIN, 'management.flag_raised'), 2, 'the work flag and the hub flag');
  assert.equal((await owner("select count(*)::int n from public.workspace_activity where event_type='management.flag_raised' and work_id=$1 and actor_id=$2 and property_id=$3", [purchase.workId, users[STAYS], property]))[0].n, 1);
  await as(STAYS);
  const tracked = (await db.query('select public.workspace_operations_read($1) data', [property])).rows[0].data.find(w => w.workId === purchase.workId);
  assert.equal(tracked.updatedEvent, 'management.flag_raised'); assert.equal(tracked.updatedBy, 'Sam Stays');
  // The flag never blocks or changes the work itself.
  const now = await workRow();
  assert.equal(now.status, before.status); assert.equal(now.version, before.version);
  assert.equal((await owner('select private.workspace_flag_open_for_work($1) w,private.workspace_flag_open_for_hub($2) h', [purchase.workId, todo.id]))[0].w, true);
});

test('a free-standing request needs only a title and a reason', async () => {
  await as(READY);
  const request = await flag({ source: 'request', title: 'New ladder for the van', reason: 'The old ladder is bent and unsafe', amountMinor: 14999 });
  assert.equal(request.workId, null); assert.equal(request.hubItemId, null); assert.equal(request.propertyId, null); assert.equal(request.amountMinor, 14999);
  const second = await flag({ source: 'request', title: 'Hi-vis jackets', reason: 'Two jackets for roadside parking' });
  assert.notEqual(second.id, request.id, 'requests are not limited to one open flag');
  assert.equal(second.amountMinor, null);
  assert.equal((await owner("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='management.flag_raised' and a.actor_id=$1 and o.user_id=$2", [users[READY], users[MANAGER]]))[0].n, 2);
});

test('management resolves, or declines with a reason; stale versions are refused', async () => {
  await as(STAYS);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version, decision: 'resolved', note: 'Fine by me' }), /Only management/);
  await as(MANAGER);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version, decision: 'declined' }), /Say why/);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version, decision: 'declined', note: ' no  ' }), /Say why/);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version, decision: 'approved', note: 'Go ahead' }), /resolved or declined/);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version + 1, decision: 'resolved' }), /Changed by someone else/);
  const resolved = await act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version, decision: 'resolved', note: 'Buy the 45 pound kettle' });
  assert.equal(resolved.status, 'resolved'); assert.equal(resolved.decidedByName, 'Mia Manager'); assert.equal(resolved.outcomeNote, 'Buy the 45 pound kettle'); assert.equal(resolved.version, workFlag.version + 1);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: resolved.version, decision: 'declined', note: 'Changed my mind' }), /already closed/);
  await assert.rejects(act({ action: 'decideFlag', flagId: workFlag.id, version: workFlag.version, decision: 'declined', note: 'Changed my mind' }), /Changed by someone else/);
  assert.equal(await notified(STAYS, 'management.flag_resolved', purchase.workId), 1, 'the raiser hears the decision');
  assert.equal(await notified(MANAGER, 'management.flag_resolved', purchase.workId), 0, 'not the person deciding');
  assert.equal((await owner('select private.workspace_flag_open_for_work($1) w', [purchase.workId]))[0].w, false);
  // Once closed, the same work can be flagged again.
  await as(READY);
  const again = await flag({ source: 'work', workId: purchase.workId, title: 'Kettle not delivered', reason: 'The supplier missed the delivery' });
  await as(ADMIN);
  const declined = await act({ action: 'decideFlag', flagId: again.id, version: again.version, decision: 'declined', note: 'Wait one more day' });
  assert.equal(declined.status, 'declined'); assert.equal(declined.decidedByName, 'Admin');
  assert.equal(await notified(READY, 'management.flag_declined', purchase.workId), 1);
  const events = (await owner("select event_type from public.workspace_activity where work_id=$1 and event_type like 'management.%' order by id", [purchase.workId])).map(r => r.event_type);
  assert.deepEqual(events, ['management.flag_raised', 'management.flag_resolved', 'management.flag_raised', 'management.flag_declined']);
});

test('only whoever raised a flag can withdraw it', async () => {
  await as(READY);
  const mine = await flag({ source: 'request', title: 'Spare van keys', reason: 'Only one set of keys for the van' });
  await as(STAYS);
  await assert.rejects(act({ action: 'withdrawFlag', flagId: mine.id, version: mine.version }), /Flag not found/);
  await as(ADMIN);
  await assert.rejects(act({ action: 'withdrawFlag', flagId: mine.id, version: mine.version }), /Only whoever raised it/);
  await as(READY);
  await assert.rejects(act({ action: 'withdrawFlag', flagId: mine.id, version: mine.version + 1 }), /Changed by someone else/);
  const withdrawn = await act({ action: 'withdrawFlag', flagId: mine.id, version: mine.version });
  assert.equal(withdrawn.status, 'withdrawn');
  await assert.rejects(act({ action: 'withdrawFlag', flagId: mine.id, version: withdrawn.version }), /already closed/);
  await as(ADMIN);
  await assert.rejects(act({ action: 'decideFlag', flagId: mine.id, version: withdrawn.version, decision: 'resolved' }), /already closed/);
});

test('a replayed request returns the same row; a reused identifier with other input is refused', async () => {
  await as(STAYS);
  const requestId = crypto.randomUUID();
  const input = { action: 'flagForManagement', requestId, source: 'request', title: 'Replay check', reason: 'Sent twice on a bad signal' };
  const first = await act(input);
  assert.deepEqual(await act(input), first);
  assert.equal((await owner("select count(*)::int n from private.workspace_management_flags where title='Replay check'"))[0].n, 1);
  await as(STAYS);
  await assert.rejects(act({ ...input, title: 'Replay changed' }), /Request identifier reused/);
  await as(ADMIN);
  const decide = { action: 'decideFlag', requestId: crypto.randomUUID(), flagId: first.id, version: first.version, decision: 'resolved' };
  const decided = await act(decide);
  assert.deepEqual(await act(decide), decided, 'the replay answers even though the flag is now closed');
  assert.equal(await notified(STAYS, 'management.flag_resolved'), 2, 'one notice per decision, not per replay');
});

test('admins read every flag, everyone else only their own, and owners are refused everything', async () => {
  await as(STAYS);
  const own = await read();
  assert.equal(own.canDecide, false);
  assert.ok(own.flags.length >= 2 && own.flags.every(f => f.raisedBy === users[STAYS] && f.mine), JSON.stringify(own.flags.map(f => f.raisedByName)));
  await as(CLEANER);
  assert.deepEqual((await read()).flags.map(f => f.title), ['Cupboard key missing']);
  await as(MANAGER);
  const all = await read();
  assert.equal(all.canDecide, true);
  assert.deepEqual([...new Set(all.flags.map(f => f.raisedByName))].sort(), ['Cara Cleaner', 'Rory Ready', 'Sam Stays']);
  assert.ok(all.flags.findIndex(f => f.status !== 'open') > all.flags.findLastIndex(f => f.status === 'open'), 'open flags first');
  // Closed flags drop off after 90 days; open ones stay however old they are.
  await owner("update private.workspace_management_flags set updated_at=now()-interval '100 days',created_at=now()-interval '100 days' where id=$1", [workFlag.id]);
  await owner("update private.workspace_management_flags set updated_at=now()-interval '100 days',created_at=now()-interval '100 days' where title='Cupboard key missing'");
  await as(MANAGER);
  const later = (await read()).flags;
  assert.equal(later.some(f => f.id === workFlag.id), false);
  assert.equal(later.some(f => f.title === 'Cupboard key missing' && f.status === 'open'), true);
  await as(CLIENT);
  await assert.rejects(read(), /Team access/);
  for (const input of [{ action: 'flagForManagement', source: 'work', workId: purchase.workId, title: 'Owner flag', reason: 'Owners cannot flag' },
    { action: 'flagForManagement', source: 'request', title: 'Owner request', reason: 'Owners cannot ask' },
    { action: 'decideFlag', flagId: workFlag.id, version: 1, decision: 'resolved' },
    { action: 'withdrawFlag', flagId: workFlag.id, version: 1 }]) await assert.rejects(act(input), /Team access/, input.action);
  await assert.rejects(db.query('select count(*) from private.workspace_management_flags'), /permission denied/);
});

test('the migration runs twice without changing a definition, and each anchor is found once', async () => {
  const fns = ['private.workspace_teams_read(text,date,date,uuid,uuid)', 'private.workspace_teams_action(jsonb)', 'private.workspace_flag_action(jsonb)', 'private.workspace_flags_read()',
    'private.workspace_flag_view(private.workspace_management_flags)', 'private.workspace_flag_open_for_work(uuid)', 'private.workspace_flag_open_for_hub(uuid)'];
  const before = await Promise.all(fns.map(definition));
  const count = (await owner('select count(*)::int n from private.workspace_management_flags'))[0].n;
  await db.exec('reset role'); await db.exec(migration);
  assert.deepEqual(await Promise.all(fns.map(definition)), before);
  assert.equal((await owner('select count(*)::int n from private.workspace_management_flags'))[0].n, count);
  const [readDef, actionDef] = before;
  const readAnchor = "elsif section='hub' then result:=private.workspace_hub_read();";
  const actionAnchor = "if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;";
  assert.equal(occurrences(readDef, readAnchor), 1); assert.equal(occurrences(readDef, "elsif section='flags' then result:=private.workspace_flags_read();"), 1);
  assert.equal(occurrences(actionDef, actionAnchor), 1);
  assert.equal(occurrences(actionDef, "if a in ('flagForManagement','decideFlag','withdrawFlag') then return private.workspace_flag_action(input);end if;"), 1);
  // A missing anchor stops the migration instead of silently skipping the route.
  await db.exec('reset role'); await db.exec('begin');
  try {
    await db.exec(readDef.replace("\n elsif section='flags' then result:=private.workspace_flags_read();", '').replace(readAnchor, "elsif section='hub' then result:=private.workspace_hub_read() ;"));
    await assert.rejects(db.exec(migration), /Patch anchor found 0 times/);
  } finally { await db.exec('rollback'); }
  assert.equal(await definition(fns[0]), readDef);
});
