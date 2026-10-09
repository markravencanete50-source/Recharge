import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Owner Home figures by period (issued statements exactly, other months estimated the way Accounts
// prepare a statement, only for the owner's own properties), and the facts the inbox chips read:
// whose conversation it is, which properties it is about, and who wrote last.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { ownerPeriodsSchema, summarisePeriod } = await vite.ssrLoadModule('/lib/owner-periods.ts');
const { conversationSchema } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { inboxActionSchema, inboxListSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const { conversationFacts, guestFacts } = await vite.ssrLoadModule('/lib/inbox-filters.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'client', 'client', 'stays'];
const [ADMIN, OWNER, OTHER_OWNER, ANNA] = [0, 1, 2, 3];
const users = roles.map((_, i) => `98100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9810', '9820');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `owner-periods${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Olive Owner', 'Oscar Other', 'Anna'][i]]);
}
for (const i of [OWNER, OTHER_OWNER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) select $1,m from unnest(array['client-dashboard','owner-statements']) m", [users[i]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'guest-communication'),($1,'property-database')", [users[ANNA]]);
const props = [];
for (const name of ['Harbour Flat', 'Loch Cottage', 'Other House']) props.push((await db.query('insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id', [name, users[ADMIN]])).rows[0].id);
const [HARBOUR, LOCH, OTHER] = props;
for (const [prop, who, kind] of [[HARBOUR, OWNER, 'client'], [LOCH, OWNER, 'client'], [OTHER, OTHER_OWNER, 'client'], [HARBOUR, ANNA, 'staff']])
  await db.query('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)', [prop, users[who], kind, users[ADMIN]]);

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
// Trusted set-up writes, as the database itself.
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const periods = async (from, to) => ownerPeriodsSchema.parse(await rpc('workspace_owner_periods', [from, to]));
const cell = (data, month, prop) => data.months.find(c => c.month === month && c.propertyId === prop);

await asDb();
const stay = (prop, ref, checkIn, checkOut, payout, channel = 'direct') => db.query(
  "insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,payout_minor) values($1,$2,$3,$4,'confirmed','manual',$5,$6,$7)",
  [prop, ref, checkIn, checkOut, users[ADMIN], channel, payout]);
// September (issued): one stay. October (not issued): two priced stays, one without a payout yet,
// and a stay that only ends in October (it belongs to September's statement).
await stay(HARBOUR, 'SEP-1', '2026-09-05', '2026-09-08', 30000);
await stay(HARBOUR, 'SEP-2', '2026-09-29', '2026-10-02', 20000);
await stay(HARBOUR, 'OCT-1', '2026-10-02', '2026-10-05', 40000);
await stay(HARBOUR, 'OCT-2', '2026-10-10', '2026-10-15', 50000, 'vrbo');
await stay(HARBOUR, 'OCT-3', '2026-10-28', '2026-10-30', null);
await stay(OTHER, 'OTHER-1', '2026-10-03', '2026-10-06', 99900);
await db.query("insert into private.workspace_property_financials(property_id,management_fee_bps,cleaning_cost_minor) values($1,2000,5000)", [HARBOUR]);
await db.query(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
  values($1,'2026-09-01','issued',50000,2,10000,2000,2000,10000,28000,$2::jsonb,$3,now())`,
  [HARBOUR, JSON.stringify({ stays: [{ reference: 'SEP-1', checkIn: '2026-09-05', checkOut: '2026-09-08', amountMinor: 30000 }, { reference: 'SEP-2', checkIn: '2026-09-29', checkOut: '2026-10-02', amountMinor: 20000 }], expenses: [], cleaningCostMinor: 5000 }), users[ADMIN]]);
// A draft for Loch Cottage in October: not shown as figures, only as "being prepared".
await db.query(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by)
  values($1,'2026-10-01','draft',123,0,0,0,0,0,123,'{"stays":[],"expenses":[]}'::jsonb,$2)`, [LOCH, users[ADMIN]]);
const clean = (await db.query("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,due_on,created_by) values(gen_random_uuid(),$1,'cleaning-schedule','Clean','completed','2026-10-06',$2) returning id", [HARBOUR, users[ADMIN]])).rows[0].id;
await db.query("insert into private.workspace_domain_details(work_id,kind,data) values($1,'cleaning','{\"phase\":\"accepted\"}'::jsonb)", [clean]);
await db.query(`insert into private.workspace_expenses(property_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
  values($1,'Plumbing Co','INV-1','maintenance','Fixed the shower leak',12000,'2026-10-07','manual','approved',$2,gen_random_uuid()),
        ($1,'Plumbing Co','INV-2','maintenance','Quote not approved yet',99000,'2026-10-08','manual','to_approve',$2,gen_random_uuid())`, [HARBOUR, users[ADMIN]]);

test('an owner sees issued statements exactly and the other months estimated, for their properties only', async () => {
  await as(OWNER);
  const data = await periods('2026-09-01', '2026-10-01');
  assert.deepEqual(data.properties.map(x => x.propertyName), ['Harbour Flat', 'Loch Cottage'], 'never another owner’s property');
  assert.equal(data.months.length, 4);
  const sep = cell(data, '2026-09', HARBOUR);
  assert.equal(sep.source, 'statement'); assert.equal(sep.status, 'issued');
  assert.deepEqual([sep.revenueMinor, sep.cleaningMinor, sep.expensesMinor, sep.feeMinor, sep.payoutMinor, sep.bookings, sep.stayNights], [50000, 10000, 2000, 10000, 28000, 2, 6], 'the issued statement, as issued');
  assert.equal(sep.bookedNights, 3 + 2, 'nights inside September, for occupancy');
  const oct = cell(data, '2026-10', HARBOUR);
  assert.equal(oct.source, 'estimate'); assert.equal(oct.status, null);
  assert.equal(oct.revenueMinor, 90000, 'stays starting in October; the one ending in October is September’s');
  assert.equal(oct.missingAmounts, 1, 'a stay without a payout is flagged, not guessed');
  assert.deepEqual([oct.bookings, oct.stayNights, oct.cleaningCount, oct.cleaningMinor, oct.expensesMinor, oct.feeMinor], [3, 3 + 5 + 2, 1, 5000, 12000, 18000], 'approved expenses only');
  assert.equal(oct.payoutMinor, 90000 - 5000 - 12000 - 18000);
  const loch = cell(data, '2026-10', LOCH);
  assert.equal(loch.source, 'estimate'); assert.equal(loch.preparing, true, 'a draft is “being prepared”, its figures are not shown');
  assert.equal(loch.revenueMinor, 0); assert.equal(loch.payoutMinor, null, 'no agreed terms: no payout estimate'); assert.equal(loch.feeMinor, null);
  // The period maths on top: October is estimated and, with Loch's terms missing, has no payout.
  const october = summarisePeriod(data.months, ['2026-10'], data.properties.length);
  assert.equal(october.basis, 'estimated'); assert.equal(october.bookingIncomeMinor, 90000); assert.equal(october.payoutMinor, null);
  assert.equal(summarisePeriod(data.months, ['2026-09'], 2, HARBOUR).basis, 'issued');
});

test('only owners read it, for their own properties, up to 25 months', async () => {
  await as(OTHER_OWNER);
  const other = await periods('2026-10-01', '2026-10-01');
  assert.deepEqual(other.properties.map(x => x.propertyId), [OTHER]);
  assert.equal(cell(other, '2026-10', OTHER).revenueMinor, 99900);
  await assert.rejects(rpc('workspace_owner_periods', ['2024-01-01', '2026-02-01']), /25 months/);
  await assert.rejects(rpc('workspace_owner_periods', ['2026-10-01', '2026-09-01']), /25 months/);
  for (const who of [ADMIN, ANNA]) { await as(who); await assert.rejects(rpc('workspace_owner_periods', ['2026-10-01', '2026-10-01']), /Owner statements access required/); }
  await asDb(); await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='owner-statements'", [users[OTHER_OWNER]]);
  await as(OTHER_OWNER);
  assert.deepEqual((await periods('2026-10-01', '2026-10-01')).properties, [], 'without the statements tool there is nothing to show');
  await asDb();
  assert.equal((await db.query("select has_function_privilege('authenticated','private.workspace_owner_period_cell(uuid,date)','execute') ok")).rows[0].ok, false, 'the per-month helper is server only');
});

test('conversations say whose they are, which properties they are about and who wrote last', async () => {
  const chat = async input => (await db.query('select public.workspace_chat_action($1::jsonb) result', [JSON.stringify(input)])).rows[0].result;
  const list = async () => (await db.query("select public.workspace_chat_read('list',null,null) result")).rows[0].result.map(c => conversationSchema.parse(c));
  await as(OWNER);
  const conversation = conversationSchema.parse(await chat({ action: 'startOwner' }));
  await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId: conversation.id, body: 'Is the boiler fixed?' });
  let mine = (await list()).find(c => c.id === conversation.id);
  assert.equal(mine.mine, true, 'the owner’s own conversation');
  // Anna looks after Harbour Flat: the conversation is hers, about the property she can see.
  await as(ANNA);
  let seen = (await list()).find(c => c.id === conversation.id);
  assert.equal(seen.mine, true); assert.deepEqual(seen.propertyIds, [HARBOUR]); assert.equal(seen.last.fromOwner, true);
  assert.equal(conversationFacts(seen).needsReply, true, 'the owner wrote last');
  // An admin sees both properties; it is not theirs until they write in it.
  await as(ADMIN);
  seen = (await list()).find(c => c.id === conversation.id);
  assert.equal(seen.mine, false); assert.deepEqual([...seen.propertyIds].sort(), [HARBOUR, LOCH].sort());
  await chat({ action: 'send', requestId: crypto.randomUUID(), conversationId: conversation.id, body: 'Yes, this morning.' });
  seen = (await list()).find(c => c.id === conversation.id);
  assert.equal(seen.mine, true); assert.equal(seen.last.fromOwner, false);
  await as(ANNA);
  seen = (await list()).find(c => c.id === conversation.id);
  assert.equal(conversationFacts(seen).needsReply, false, 'a colleague answered the owner');
  await as(OWNER);
  mine = (await list()).find(c => c.id === conversation.id);
  assert.equal(conversationFacts(mine, true).needsReply, true, 'for the owner, Recharge wrote last');
});

test('a guest conversation is mine once I log or reply in it, or I look after the property', async () => {
  const act = async input => rpc('workspace_guest_inbox_action', [inboxActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
  const threads = async () => inboxListSchema.parse(await rpc('workspace_guest_inbox_read', ['list', null, 'all'])).threads;
  await as(ADMIN);
  const logged = await act({ action: 'logMessage', channel: 'airbnb', guestName: 'Tom Guest', propertyId: LOCH, body: 'Can we check in early?' });
  await act({ action: 'logMessage', channel: 'airbnb', guestName: 'Hana Guest', propertyId: HARBOUR, body: 'Where are the towels?' });
  let list = await threads();
  assert.equal(list.find(t => t.guestName === 'Tom Guest').mine, true, 'the admin logged it');
  assert.equal(list.find(t => t.guestName === 'Hana Guest').mine, true);
  await as(ANNA);
  list = await threads();
  assert.deepEqual(list.map(t => t.guestName), ['Hana Guest'], 'Anna sees her property only');
  assert.equal(list[0].mine, true, 'she looks after Harbour Flat');
  assert.equal(guestFacts(list[0]).needsReply, true); assert.equal(guestFacts(list[0]).unread, true);
  assert.equal(guestFacts(list[0], new Date(Date.now() + 60000).toISOString()).unread, false, 'opened since the guest wrote');
  // Anna logs one; it isn't the admin's until the admin replies.
  const annas = await act({ action: 'logMessage', channel: 'direct', guestName: 'Ivy Guest', propertyId: HARBOUR, body: 'Is there parking?' });
  await as(ADMIN);
  const ivy = async () => (await threads()).find(t => t.guestName === 'Ivy Guest');
  assert.equal((await ivy()).mine, false);
  await act({ action: 'reply', threadId: annas.id, body: 'Yes, space 4.' });
  assert.equal((await ivy()).mine, true);
  assert.equal(guestFacts(await ivy()).needsReply, false, 'answered');
  assert.ok(logged.id);
});
