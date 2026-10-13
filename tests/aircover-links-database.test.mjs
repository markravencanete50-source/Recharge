import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// AirCover claims linked to maintenance tickets (20261012190000): any team role that can work a maintenance
// or routine-visit ticket can flag it as a claim, accounts and admins hear about it, a ticket has one live
// claim at a time, and the aircover read shows each claim with its linked issue. Owners are refused.
const NAME = '20261012190000_aircover_links';
const dir = 'supabase/migrations/';
const files = await fs.readdir(dir);
const migrationFile = files.includes(NAME + '.sql') ? NAME + '.sql' : NAME + '.sql.draft';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of files.filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile(dir + file, 'utf8'));
// While the migration is still a draft it is applied last, on top of everything else.
if (migrationFile.endsWith('.draft')) await db.exec(await fs.readFile(dir + migrationFile, 'utf8'));
after(async () => { await db.close(); });

const roles = ['super_admin', 'admin', 'accounts', 'stays', 'stays', 'ready', 'cleans', 'cleans', 'client'];
const names = ['Person Super', 'Person Admin', 'Person Accounts', 'Person Stays', 'Person Roaming', 'Person Ready', 'Person Cleaner', 'Person Other Cleaner', 'Client Olive'];
const users = roles.map((_, i) => `e6000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, STAYS, ROAMING, READY, CLEANER, OTHER_CLEANER, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('e600', 'e700');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `aircover${i}@example.com`]);
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
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = (input, requestId = crypto.randomUUID()) => rpc('workspace_teams_action', [{ requestId, ...input }]);
const flag = (workId, extra = {}, requestId) => act({ action: 'flagAirCover', workId, ...extra }, requestId);
const move = (item, status, extra = {}) => act({ action: 'moveHubItem', id: item.id, version: item.version, status, ...extra });
const read = (property = null) => rpc('workspace_teams_read', ['aircover', null, null, property, null]);
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const notified = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Claim flat', address: '12 Dundas Street, Edinburgh' }]);
const FAR = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Far cottage', address: '9 Harbour Road, Oban' }]);
for (const who of [STAYS, READY]) await rpc('workspace_assign_property', [HOME, users[who], 'staff']);
for (const who of [CLEANER, OTHER_CLEANER]) await rpc('workspace_assign_property', [HOME, users[who], 'cleaner']);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);

// Tickets are made the way the app makes them: a handover with a domain kind and its data.
const work = {};
async function ticket(key, kind, title, data = {}, module = 'stays-maintenance-reporting', property = HOME) {
  await as(SUPER);
  await db.exec('reset role');
  const id = (await db.query('select private.workspace_handover($1,$2,$3,$4,$5::jsonb) id', [property, module, title, kind, JSON.stringify(data)])).rows[0].id;
  work[key] = id;
  return id;
}
await ticket('boiler', 'maintenance', 'Boiler not heating', { phase: 'triage', repairType: 'heating', urgent: true, referredAt: new Date().toISOString() });
await ticket('tap', 'maintenance', 'Dripping tap in the bathroom', { phase: 'booked', repairType: 'leak', urgent: false, referredAt: new Date().toISOString() });
await ticket('gutter', 'maintenance', 'Gutter cleared out of season', { phase: 'triage', repairType: 'damage' });
await ticket('visit', 'routine_visit', 'October routine visit', { checklist: ['Smoke alarms', 'Gutters'], phase: 'planned' });
await ticket('clean', 'cleaning', 'Checkout clean', { phase: 'assigned' }, 'cleaning-schedule');
await ticket('cleanerJob', 'maintenance', 'Broken bin lid', { phase: 'triage', repairType: 'damage' }, 'cleaning-schedule');
await ticket('otherJob', 'maintenance', 'Loose carpet edge', { phase: 'triage', repairType: 'damage' }, 'cleaning-schedule');
await ticket('farJob', 'maintenance', 'Cracked slate', { phase: 'triage', repairType: 'damage' }, 'stays-maintenance-reporting', FAR);
await sql('update public.workspace_work_items set assignee_id=$2 where id=$1', [work.cleanerJob, users[CLEANER]]);
await sql('update public.workspace_work_items set assignee_id=$2 where id=$1', [work.otherJob, users[OTHER_CLEANER]]);

test('any team role that can work a maintenance ticket can flag it, with defaults from the ticket', async () => {
  await as(READY);
  const first = await flag(work.boiler);
  assert.equal(first.kind, 'aircover');
  assert.equal(first.status, 'to_claim');
  assert.equal(first.title, 'Boiler not heating', 'the title comes from the ticket');
  assert.equal(first.propertyId, HOME, 'so does the property');
  assert.equal(first.workId, work.boiler);
  assert.equal(first.amountMinor, null);
  assert.equal(first.reference, '');
  const row = (await sql('select * from private.workspace_hub_items where id=$1', [first.id]))[0];
  assert.equal(row.work_id, work.boiler);
  assert.equal(row.created_by, users[READY]);
  const event = (await sql("select * from public.workspace_activity where event_type='aircover.flagged' and work_id=$1", [work.boiler]))[0];
  assert.ok(event, 'an aircover.flagged event carries the work id');
  assert.equal(event.property_id, HOME);
  assert.equal(event.actor_id, users[READY]);
  // Accounts and admins hear about it; the flagger and other roles do not.
  assert.equal(await notified(ACCOUNTS, 'aircover.flagged'), 1);
  assert.equal(await notified(ADMIN, 'aircover.flagged'), 1);
  assert.equal(await notified(SUPER, 'aircover.flagged'), 1);
  for (const quiet of [READY, STAYS, CLEANER, OWNER]) assert.equal(await notified(quiet, 'aircover.flagged'), 0);
  // A stays person flags a routine visit, naming their own title and a figure.
  await as(STAYS);
  const visit = await flag(work.visit, { title: 'Smoke alarm failed its test', amountMinor: 18000, reference: 'AC-4471' });
  assert.equal(visit.title, 'Smoke alarm failed its test');
  assert.equal(visit.amountMinor, 18000);
  assert.equal(visit.reference, 'AC-4471');
  assert.equal(visit.workId, work.visit);
  // An assigned cleaner can flag a ticket they can work (cleaners only work cleaning-board tickets), and no other.
  await as(CLEANER);
  const bin = await flag(work.cleanerJob);
  assert.equal(bin.workId, work.cleanerJob);
  await assert.rejects(flag(work.otherJob), /Record not found/);
  await assert.rejects(flag(work.boiler), /Record not found/);
  // Someone who is not on the property cannot work its tickets, so cannot flag them.
  await as(READY);
  await assert.rejects(flag(work.farJob), /Record not found/);
  // The hub shows the link too.
  await as(ACCOUNTS);
  const hub = await rpc('workspace_teams_read', ['hub', null, null, null, null]);
  assert.equal(hub.items.find(i => i.id === first.id).workId, work.boiler);
});

test('a stays person with no access to the property cannot start a claim on its tickets', async () => {
  await as(ROAMING);
  await assert.rejects(flag(work.boiler), /Record not found/);
  await assert.rejects(flag(work.farJob), /Record not found/);
});

test('only maintenance and routine visits are claimable, and the inputs are checked', async () => {
  await as(ADMIN);
  await assert.rejects(flag(work.clean), /Only a maintenance ticket/);
  await assert.rejects(flag(crypto.randomUUID()), /Record not found/);
  await assert.rejects(act({ action: 'flagAirCover' }), /Choose the issue/);
  await assert.rejects(flag(work.farJob, { colour: 'red' }), /Unknown or oversized/);
  await assert.rejects(flag(work.farJob, { title: 'x' }), /Invalid field title/);
  await assert.rejects(flag(work.farJob, { amountMinor: 12.5 }), /Integer amount/);
  await assert.rejects(flag(work.farJob, { amountMinor: -5 }), /Integer amount/);
  await assert.rejects(flag(work.farJob, { reference: 'r'.repeat(121) }), /reference is too long/);
  // Nothing was written by the refusals.
  assert.equal((await sql('select count(*)::int n from private.workspace_hub_items where work_id=$1', [work.farJob]))[0].n, 0);
  // Stays and accounts keep AirCover claims, so they may flag a ticket in any property; others need to work it.
  await as(ACCOUNTS);
  const far = await flag(work.farJob);
  assert.equal(far.propertyId, FAR);
  await as(READY);
  await assert.rejects(flag(work.farJob), /Record not found/, 'a ready person is not on the far cottage');
});

test('one live claim per ticket: a declined or paid one frees it', async () => {
  await as(STAYS);
  const claim = await flag(work.tap);
  await assert.rejects(flag(work.tap), /already has an AirCover claim in progress/);
  await as(READY);
  await assert.rejects(flag(work.tap, { title: 'Same tap, second go' }), /already has an AirCover claim in progress/);
  await as(ACCOUNTS);
  const claimed = await move(claim, 'claimed');
  await assert.rejects(flag(work.tap), /already has an AirCover claim in progress/, 'a claim that was made is still live');
  const declined = await move(claimed, 'declined', { note: 'Wear and tear, not covered' });
  assert.equal(declined.status, 'declined');
  const again = await flag(work.tap, { title: 'Dripping tap, second claim', amountMinor: 9500 });
  assert.notEqual(again.id, claim.id);
  assert.equal(again.status, 'to_claim');
  // Reopening the declined claim while the new one is live is refused with a plain message.
  await assert.rejects(move(declined, 'to_claim'), /already has an AirCover claim in progress/);
  const paid = await move(await move(again, 'claimed'), 'paid', { settledMinor: 9000 });
  assert.equal(paid.settledMinor, 9000);
  const third = await flag(work.tap, { title: 'Dripping tap, third claim' });
  assert.equal(third.status, 'to_claim');
  const live = await sql("select count(*)::int n from private.workspace_hub_items where work_id=$1 and status in ('to_claim','claimed')", [work.tap]);
  assert.equal(live[0].n, 1);
  // The database itself also refuses a second live claim.
  await assert.rejects(db.query("insert into private.workspace_hub_items(kind,title,property_id,status,created_by,work_id) values('aircover','Direct duplicate',$1,'to_claim',$2,$3)", [HOME, users[ACCOUNTS], work.tap]), /AirCover claim in progress|duplicate key/);
});

test('the aircover read shows claims with the linked issue; flaggers see their own, claim keepers see all', async () => {
  await as(SUPER);
  await sql("delete from private.workspace_hub_items where kind='aircover'");
  await sql("delete from private.workspace_notification_outbox o using public.workspace_activity a where a.id=o.event_id and a.event_type='aircover.flagged'");
  await as(READY);
  const boiler = await flag(work.boiler, { amountMinor: 42000 });
  await as(CLEANER);
  const bin = await flag(work.cleanerJob);
  await as(STAYS);
  const visit = await flag(work.visit);
  await as(ACCOUNTS);
  const manual = await act({ action: 'saveHubItem', kind: 'aircover', title: 'Guest damage, no ticket', amountMinor: 25000 });
  await move(boiler, 'claimed');

  const everything = await read();
  assert.equal(everything.section, 'aircover');
  assert.equal(everything.canManage, true);
  assert.deepEqual(everything.claims.map(c => c.itemId).sort(), [boiler.id, bin.id, visit.id, manual.id].sort());
  const b = everything.claims.find(c => c.itemId === boiler.id);
  assert.equal(b.status, 'claimed');
  assert.equal(b.amountMinor, 42000);
  assert.equal(b.settledMinor, null);
  assert.equal(b.propertyName, 'Claim flat');
  assert.equal(b.address, '12 Dundas Street, Edinburgh');
  assert.equal(b.workId, work.boiler);
  assert.equal(b.issue.title, 'Boiler not heating');
  assert.equal(b.issue.repairType, 'heating');
  assert.equal(b.issue.urgent, true);
  assert.equal(b.issue.phase, 'triage');
  assert.equal(b.issue.status, 'waiting');
  assert.equal(b.issue.kind, 'maintenance');
  assert.equal(b.flaggedBy, 'Person Ready');
  assert.equal(b.mine, false);
  assert.ok(b.createdAt && b.updatedAt && b.version);
  const v = everything.claims.find(c => c.itemId === visit.id);
  assert.equal(v.issue.kind, 'routine_visit');
  assert.equal(v.issue.phase, 'planned');
  const m = everything.claims.find(c => c.itemId === manual.id);
  assert.equal(m.issue, null, 'a claim raised by hand has no linked issue');
  assert.equal(m.workId, null);
  assert.equal(everything.claims[0].itemId, manual.id, 'newest live claim first');

  // Every role that keeps claims sees them all; narrowing by property works.
  for (const who of [SUPER, ADMIN, STAYS, ROAMING]) { await as(who); assert.equal((await read()).claims.length, 4); }
  await as(ACCOUNTS);
  assert.deepEqual((await read(FAR)).claims, []);
  assert.equal((await read(HOME)).claims.length, 3, 'the hand-made claim names no property');
  // Anyone else sees only the claims they flagged.
  await as(CLEANER);
  const own = await read();
  assert.equal(own.canManage, false);
  assert.deepEqual(own.claims.map(c => c.itemId), [bin.id]);
  assert.equal(own.claims[0].mine, true);
  await as(READY);
  assert.deepEqual((await read()).claims.map(c => c.itemId), [boiler.id]);
  await as(OTHER_CLEANER);
  assert.deepEqual((await read()).claims, [], 'a cleaner cannot see others\' claims');
  // Paid and declined claims drop out after 90 days.
  await as(ACCOUNTS);
  const done = await move(await move(bin, 'claimed'), 'paid', { settledMinor: 1000 });
  assert.equal((await read()).claims.find(c => c.itemId === done.id).status, 'paid');
  await sql("update private.workspace_hub_items set updated_at=now()-interval '120 days' where id=$1", [done.id]);
  await as(ACCOUNTS);
  assert.equal((await read()).claims.some(c => c.itemId === done.id), false);
});

test('the owner is refused, hub saves cannot set the link, and the link only belongs on AirCover rows', async () => {
  await as(OWNER);
  await assert.rejects(flag(work.boiler), /Team access required/);
  await assert.rejects(read(), /Team access required/);
  await as(ACCOUNTS);
  await assert.rejects(act({ action: 'saveHubItem', kind: 'aircover', title: 'Sneaky link', workId: work.boiler }), /Unknown or oversized/);
  await asDb();
  await assert.rejects(db.query("insert into private.workspace_hub_items(kind,title,assignee_id,status,created_by,work_id) values('todo','Not a claim',$1,'open',$1,$2)", [users[ACCOUNTS], work.boiler]), /workspace_hub_items_work_only_aircover/);
  await assert.rejects(db.query("insert into private.workspace_hub_items(kind,title,status,created_by,work_id) values('invoice','Not a claim','to_send',$1,$2)", [users[ACCOUNTS], work.boiler]), /workspace_hub_items_work_only_aircover/);
  await as(ACCOUNTS);
  await assert.rejects(db.query('select private.workspace_aircover_action($1::jsonb)', ['{}']), /permission denied/);
  await assert.rejects(db.query('select private.workspace_aircover_read(null)'), /permission denied/);
  await assert.rejects(db.query('select private.workspace_hub_claim_guard()'), /permission denied/);
  await as(READY);
  await assert.rejects(flag(work.boiler), /already has an AirCover claim in progress/);
});

test('the same request replays, a reused request id with other input is refused, and edits keep the link', async () => {
  await as(STAYS);
  const requestId = crypto.randomUUID();
  const first = await flag(work.gutter, { amountMinor: 3000 }, requestId);
  const replay = await flag(work.gutter, { amountMinor: 3000 }, requestId);
  assert.deepEqual(replay, first);
  assert.equal((await sql('select count(*)::int n from private.workspace_hub_items where work_id=$1', [work.gutter]))[0].n, 1);
  assert.equal((await sql("select count(*)::int n from public.workspace_activity where event_type='aircover.flagged' and work_id=$1", [work.gutter]))[0].n, 1);
  await as(STAYS);
  await assert.rejects(flag(work.gutter, { amountMinor: 3500 }, requestId), /Request identifier reused/);
  await assert.rejects(rpc('workspace_teams_action', [{ action: 'flagAirCover', workId: work.gutter }]), /Request identifier required/);
  // Editing the claim through the hub leaves the link in place.
  await as(ACCOUNTS);
  const edited = await act({ action: 'saveHubItem', kind: 'aircover', id: first.id, version: first.version, title: 'Gutter damage', amountMinor: 5000, propertyId: HOME });
  assert.equal(edited.title, 'Gutter damage');
  assert.equal(edited.workId, work.gutter);
  assert.equal((await sql('select work_id from private.workspace_hub_items where id=$1', [first.id]))[0].work_id, work.gutter);
});

test('the migration runs twice and every patch is in exactly once', async () => {
  const migration = await fs.readFile(dir + migrationFile, 'utf8');
  await asDb();
  await db.exec(migration);
  await db.exec(migration);
  const count = async (fn, needle) => {
    const { rows } = await db.query(`select pg_get_functiondef('${fn}'::regprocedure) d`);
    return rows[0].d.split(needle).length - 1;
  };
  assert.equal(await count('private.workspace_hub_view(private.workspace_hub_items)', '\'workId\',item.work_id'), 1);
  assert.equal(await count('private.workspace_teams_read(text,date,date,uuid,uuid)', 'private.workspace_aircover_read(target_property)'), 1);
  assert.equal(await count('private.workspace_teams_action(jsonb)', 'private.workspace_aircover_action(input)'), 1);
  // The routes it sits next to are still there once each.
  assert.equal(await count('private.workspace_teams_read(text,date,date,uuid,uuid)', 'elsif section=\'hub\' then result:=private.workspace_hub_read();'), 1);
  assert.equal(await count('private.workspace_teams_action(jsonb)', 'if a in (\'saveHubItem\',\'moveHubItem\') then return private.workspace_hub_action(input);end if;'), 1);
  assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='private.workspace_hub_items'::regclass and conname='workspace_hub_items_work_only_aircover'")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='private.workspace_hub_items'::regclass and tgname='workspace_hub_claim_guard'")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from pg_indexes where schemaname='private' and tablename='workspace_hub_items' and indexname in ('workspace_hub_items_work_idx','workspace_hub_items_live_claim_idx')")).rows[0].n, 2);
  // Nothing is exposed to the public roles.
  for (const fn of ['private.workspace_aircover_action(jsonb)', 'private.workspace_aircover_read(uuid)', 'private.workspace_hub_claim_guard()']) {
    assert.equal((await db.query(`select has_function_privilege('authenticated','${fn}','execute') ok`)).rows[0].ok, false, fn);
    assert.equal((await db.query(`select has_function_privilege('anon','${fn}','execute') ok`)).rows[0].ok, false, fn);
  }
  // Still working after the second run.
  await as(ACCOUNTS);
  const flagged = await flag(work.farJob, { title: 'Slate after the second run' });
  assert.equal(flagged.workId, work.farJob);
  assert.equal((await read(FAR)).claims.length, 1);
});
