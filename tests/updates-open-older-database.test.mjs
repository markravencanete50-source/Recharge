import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The Updates feed, round 7 (20261017300000): one work item opened on its own, with the work list's rules (an owner never
// gets a staff-only item, and "not yours" reads exactly like "does not exist"), and older updates 50 at a time. Every
// migration is applied in order; this one again to prove a second run changes nothing.
const MINE = '20261017300000_updates_open_and_older';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
// The second run is checked before the later migrations, which patch the feed read (20261025500000 adds the guest's name).
const mineAt = files.indexOf(MINE + '.sql');
for (const file of files.slice(0, mineAt + 1)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_controls_read(text,uuid,uuid)', 'private.workspace_notifications_read(bigint)', 'private.workspace_operation_read(uuid)'];
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));
for (const file of files.slice(mineAt + 1)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['admin', 'stays', 'client', 'client', 'cleans'];
const [ADMIN, STAYS, OWNER, OTHER_OWNER, CLEANER] = roles.map((_, i) => i);
const names = ['Ada Admin', 'Sam Reid', 'Olive Owner', 'Otto Other', 'Cara Cleaner'];
const users = roles.map((_, i) => `98900000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9890', '9891');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `updates7-${i}@example.com`]);
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
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const one = async (who, workId) => { await as(who); return (await db.query('select public.workspace_operation_read($1) r', [workId])).rows[0].r; };
const page = async (who, before = null) => { await as(who); return (await db.query('select public.workspace_notifications_read($1) r', [before])).rows[0].r; };
const feed = async who => { await as(who); return (await db.query("select public.workspace_controls_read('notifications',null,null) r")).rows[0].r; };

await asDatabase();
const newProperty = async name => (await db.query("insert into public.workspace_properties(name,address,region,created_by,request_id) values($1,$1||', Edinburgh','Edinburgh',$2,gen_random_uuid()) returning id", [name, users[ADMIN]])).rows[0].id;
const property = await newProperty('Harbour Flat'), otherProperty = await newProperty('Other Flat');
for (const [who, kind, prop] of [[STAYS, 'staff', property], [OWNER, 'client', property], [OTHER_OWNER, 'client', otherProperty], [CLEANER, 'staff', property]])
  await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)', [prop, users[who], kind, users[ADMIN]]);
async function workItem(kind, title, moduleId, { clientVisible = false, prop = property, data = {} } = {}) {
  const id = (await db.query(`insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),$1,$2,$3,$4,$5) returning id`, [prop, moduleId, title, users[ADMIN], clientVisible])).rows[0].id;
  await db.query('insert into private.workspace_domain_details(work_id,kind,data) values($1,$2,$3)', [id, kind, data]);
  return id;
}
// A repair the owner may see, a staff-only pricing task at the same property, and a repair at a property the owner is not on.
const repair = await workItem('maintenance', 'Boiler not working', 'stays-maintenance-reporting', { clientVisible: true, data: { guestEvidence: 'secret note', troubleshooting: 'staff steps' } });
const staffOnly = await workItem('daily_pricing', '3 empty nights to price', 'daily-pricing');
const elsewhere = await workItem('maintenance', 'Leak elsewhere', 'stays-maintenance-reporting', { clientVisible: true, prop: otherProperty });
const NOT_FOUND = /Work item not found/;

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('one work item opens with the work list\'s view: staff see it whole', async () => {
  for (const who of [ADMIN, STAYS]) {
    const item = await one(who, staffOnly);
    assert.deepEqual([item.workId, item.title, item.kind], [staffOnly, '3 empty nights to price', 'daily_pricing'], names[who]);
  }
  // The same object the work list gives for it.
  await as(STAYS);
  const list = (await db.query('select public.workspace_operations_read(null) r')).rows[0].r;
  assert.deepEqual(await one(STAYS, repair), list.find(w => w.workId === repair));
});

test('owners get only their own client-visible items, in the owner view; anything else reads exactly like a missing item', async () => {
  const mine = await one(OWNER, repair);
  assert.equal(mine.workId, repair);
  assert.equal(mine.updatedBy, null, 'no staff name');
  assert.ok(!('guestEvidence' in mine.data) && !('troubleshooting' in mine.data), 'staff fields are left out');
  // A staff-only item at their own property, an item at someone else's property, and an id that does not exist: the same refusal.
  const refusals = [];
  for (const target of [staffOnly, elsewhere, '00000000-0000-4000-8000-000000000000']) {
    const error = await one(OWNER, target).then(() => null, e => e);
    assert.ok(error, `refused: ${target}`);
    assert.match(error.message, NOT_FOUND);
    refusals.push([error.code, error.message]);
  }
  assert.equal(new Set(refusals.map(r => r.join('|'))).size, 1, 'a staff-only item cannot be told apart from one that does not exist');
  // Nothing about the refused items leaks into the message.
  assert.ok(refusals.every(([, message]) => !/pricing|empty nights|Leak/i.test(message)));
  // The other owner sees their own, not this one.
  assert.equal((await one(OTHER_OWNER, elsewhere)).workId, elsewhere);
  await assert.rejects(one(OTHER_OWNER, repair), NOT_FOUND);
});

test('a cleaner gets only the cleans assigned to them; nobody signed out reads anything', async () => {
  await assert.rejects(one(CLEANER, repair), NOT_FOUND);
  await assert.rejects(one(CLEANER, staffOnly), NOT_FOUND);
  // No signed-in person, no read.
  await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_operation_read($1)', [repair]), /permission denied/);
  await assert.rejects(db.query('select public.workspace_notifications_read(null)'), /permission denied/);
});

test('older updates: 50 at a time, newest first, no gaps or repeats, even when several share a time', async () => {
  // 130 updates for Sam, ten of them at the same moment, plus a few for the owner.
  await asDatabase();
  const ids = [];
  for (let i = 0; i < 130; i++) {
    const at = i >= 60 && i < 70 ? '2026-10-10T09:00:00Z' : new Date(Date.parse('2026-10-12T12:00:00Z') - i * 60000).toISOString();
    const ev = (await db.query('insert into public.workspace_activity(property_id,work_id,event_type,created_at) values($1,$2,$3,$4) returning id', [property, staffOnly, 'handover.created', at])).rows[0].id;
    await db.query('insert into private.workspace_notification_outbox(user_id,event_id,work_id) values($1,$2,$3) on conflict do nothing', [users[STAYS], ev, staffOnly]);
    ids.push(ev);
  }
  const first = await feed(STAYS);
  assert.equal(first.length, 50, 'the feed still gives the newest 50');
  assert.deepEqual(first, await page(STAYS), 'the feed is the first page of the new read');
  const seen = [...first];
  for (let cursor = first.at(-1).id, guard = 0; guard < 5; guard++) {
    const next = await page(STAYS, cursor);
    if (!next.length) break;
    assert.ok(next.length <= 50);
    seen.push(...next);
    cursor = next.at(-1).id;
  }
  const order = [...seen].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  assert.deepEqual(seen.map(n => n.id), order.map(n => n.id), 'newest first across pages');
  assert.equal(new Set(seen.map(n => n.id)).size, seen.length, 'no update twice');
  for (const id of ids) assert.ok(seen.some(n => n.id === id), `update ${id} is on a page`);
  // Pages carry the same fields as the feed.
  assert.deepEqual(Object.keys(seen.at(-1)).sort(), Object.keys(first[0]).sort());
});

test('older updates for an owner: only their own, never a staff name; a cursor must be one of your own updates', async () => {
  await asDatabase();
  const owned = [];
  for (let i = 0; i < 55; i++) {
    const ev = (await db.query('insert into public.workspace_activity(actor_id,property_id,work_id,event_type,created_at) values($1,$2,$3,$4,$5) returning id',
      [users[STAYS], property, repair, 'operations.updateOperation.completeRepair', new Date(Date.parse('2026-10-11T12:00:00Z') - i * 60000).toISOString()])).rows[0].id;
    await db.query('insert into private.workspace_notification_outbox(user_id,event_id,work_id) values($1,$2,$3) on conflict do nothing', [users[OWNER], ev, repair]);
    owned.push(ev);
  }
  const first = await feed(OWNER);
  const rest = await page(OWNER, first.at(-1).id);
  const all = [...first, ...rest];
  assert.deepEqual(all.map(n => n.id).sort((a, b) => a - b), [...owned].sort((a, b) => a - b), 'exactly their own updates');
  assert.ok(all.every(n => n.actor_name === 'Recharge' && n.automatic === false));
  assert.ok(!JSON.stringify(all).includes('Sam Reid'));
  // Someone else's update, or one that does not exist, is not a cursor.
  const samsUpdate = (await page(STAYS))[0].id;
  await assert.rejects(page(OWNER, samsUpdate), /Choose one of your updates/);
  await assert.rejects(page(OWNER, 999999999), /Choose one of your updates/);
});
