import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Owner-entered monthly expenses (assumption h): they change only the net figure the owner sees,
// never the payout. Only the owner of the property can add or remove them, a month with an issued
// or paid statement is locked, and the owner's read never carries staff names or internal flags.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { ownerPeriodsSchema, summarisePeriod } = await vite.ssrLoadModule('/lib/owner-periods.ts');
const { ownerActionSchema } = await vite.ssrLoadModule('/lib/owner-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const migrations = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of migrations) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'client', 'client', 'stays', 'accounts'];
const [ADMIN, OWNER, OTHER_OWNER, ANNA, ACCOUNTS] = [0, 1, 2, 3, 4];
const names = ['Adele Admin', 'Olive Owner', 'Oscar Other', 'Anna Stays', 'Alex Accounts'];
const users = roles.map((_, i) => `98300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9830', '9840');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `owner-expenses${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
for (const i of [OWNER, OTHER_OWNER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) select $1,m from unnest(array['client-dashboard','owner-statements']) m", [users[i]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'owner-statements'),($1,'property-database')", [users[ANNA]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'owner-statements')", [users[ACCOUNTS]]);
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
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const save = (input) => rpc('workspace_owner_save_expense', [{ action: 'saveOwnerExpense', requestId: crypto.randomUUID(), propertyId: HARBOUR, month: '2026-10', amountMinor: 2500, category: 'maintenance', note: 'Boiler service', ...input }]);
const remove = expenseId => rpc('workspace_owner_remove_expense', [{ action: 'removeOwnerExpense', expenseId }]);
const periods = async (from, to) => ownerPeriodsSchema.parse(await rpc('workspace_owner_periods', [from, to]));
const cell = (data, month, prop) => data.months.find(c => c.month === month && c.propertyId === prop);
// Reads the table as the database itself, then goes back to whoever was signed in.
const rows = async () => {
  const who = (await db.query('select current_user u')).rows[0].u;
  await db.exec('reset role');
  const found = (await db.query('select * from private.workspace_owner_expenses order by created_at,id')).rows;
  if (who !== 'postgres') await db.exec('set role ' + who);
  return found;
};

// The same set-up as the owner statements tests: September issued (payout 28000), October estimated
// (payout 55000), Loch Cottage without agreed terms (no payout figure).
await asDb();
const stay = (prop, ref, checkIn, checkOut, payout) => db.query(
  "insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,payout_minor) values($1,$2,$3,$4,'confirmed','manual',$5,'direct',$6)",
  [prop, ref, checkIn, checkOut, users[ADMIN], payout]);
await stay(HARBOUR, 'SEP-1', '2026-09-05', '2026-09-08', 30000);
await stay(HARBOUR, 'SEP-2', '2026-09-29', '2026-10-02', 20000);
await stay(HARBOUR, 'OCT-1', '2026-10-02', '2026-10-05', 40000);
await stay(HARBOUR, 'OCT-2', '2026-10-10', '2026-10-15', 50000);
await db.query("insert into private.workspace_property_financials(property_id,management_fee_bps,cleaning_cost_minor) values($1,2000,5000)", [HARBOUR]);
// Once statements carry an end date (a later migration) the column is filled in too, one month on.
const hasEnd = async () => (await db.query("select count(*)::int n from pg_attribute where attrelid='private.workspace_owner_statements'::regclass and attname='period_end' and not attisdropped")).rows[0].n > 0;
const statement = async (prop, start, status) => {
  const end = await hasEnd();
  await db.query(`insert into private.workspace_owner_statements(property_id,period_start,${end ? 'period_end,' : ''}status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
    values($1,$2,${end ? "($2::date+interval '1 month')::date," : ''}$3,50000,2,10000,2000,2000,10000,28000,'{"stays":[],"expenses":[]}'::jsonb,$4,${status === 'draft' ? 'null' : 'now()'})`, [prop, start, status, users[ADMIN]]);
};
await statement(HARBOUR, '2026-09-01', 'issued');
const clean = (await db.query("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,due_on,created_by) values(gen_random_uuid(),$1,'cleaning-schedule','Clean','completed','2026-10-06',$2) returning id", [HARBOUR, users[ADMIN]])).rows[0].id;
await db.query("insert into private.workspace_domain_details(work_id,kind,data) values($1,'cleaning','{\"phase\":\"accepted\"}'::jsonb)", [clean]);
await db.query(`insert into private.workspace_expenses(property_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
  values($1,'Plumbing Co','INV-1','maintenance','Fixed the shower leak',12000,'2026-10-07','manual','approved',$2,gen_random_uuid())`, [HARBOUR, users[ADMIN]]);

test('the table is private and nobody but the database functions can touch it', async () => {
  await asDb();
  assert.equal((await db.query("select relrowsecurity ok from pg_class where oid='private.workspace_owner_expenses'::regclass")).rows[0].ok, true);
  for (const who of [OWNER, ACCOUNTS, ADMIN]) {
    await as(who);
    await assert.rejects(db.query('select * from private.workspace_owner_expenses'), /permission denied/);
    await assert.rejects(db.query("insert into private.workspace_owner_expenses(property_id,owner_id,month,category,amount_minor,request_id) values($1,$2,'2026-10-01','other',100,gen_random_uuid())", [HARBOUR, users[who]]), /permission denied/);
  }
  await asDb();
  for (const fn of ['private.workspace_owner_month_locked(uuid,date)', 'private.workspace_owner_expense_keys(uuid,date,bigint)', 'private.workspace_owner_cell_with_expenses(uuid,date)'])
    assert.equal((await db.query('select has_function_privilege(\'authenticated\',$1,\'execute\') ok', [fn])).rows[0].ok, false, fn + ' is server only');
  assert.equal((await db.query("select has_function_privilege('anon','public.workspace_owner_save_expense(jsonb)','execute') ok")).rows[0].ok, false);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='private.workspace_owner_expenses'::regclass and tgname='business_write_limit'")).rows[0].n, 1);
});

test('saving is idempotent by request, and the same request cannot carry a different expense', async () => {
  await as(OWNER);
  const requestId = crypto.randomUUID();
  const first = await save({ requestId });
  assert.equal(first.amountMinor, 2500); assert.equal(first.category, 'maintenance'); assert.equal(first.month, '2026-10'); assert.equal(first.propertyId, HARBOUR);
  const again = await save({ requestId });
  assert.equal(again.id, first.id, 'a retry after a lost response replays the original');
  assert.equal((await rows()).length, 1);
  await assert.rejects(save({ requestId, amountMinor: 9900 }), /already used for a different expense/);
  assert.equal((await rows()).length, 1);
  assert.deepEqual(Object.keys(first).sort(), ['amountMinor', 'category', 'createdAt', 'id', 'month', 'note', 'propertyId'], 'no owner id, request id or staff detail comes back');
  const second = await save({ amountMinor: 1500, category: 'supplies', note: '' });
  assert.notEqual(second.id, first.id); assert.equal(second.note, '');
  // Another owner can reuse the same request id: it is unique per owner.
  await as(OTHER_OWNER);
  const theirs = await save({ requestId, propertyId: OTHER });
  assert.notEqual(theirs.id, first.id);
});

test('amounts, categories, months and notes are validated', async () => {
  await as(OWNER);
  const stored = (await rows()).length;
  const refuse = (input, pattern) => assert.rejects(save(input), pattern);
  await refuse({ amountMinor: 0 }, /amount between 1p and/);
  await refuse({ amountMinor: -500 }, /Enter the amount/);
  await refuse({ amountMinor: 12.5 }, /Enter the amount/);
  await refuse({ amountMinor: '2500' }, /Enter the amount/);
  await refuse({ amountMinor: 10000001 }, /amount between 1p and/);
  await refuse({ category: 'holiday' }, /Choose a category/);
  await refuse({ category: null }, /Choose a category/);
  await refuse({ month: '2026-13' }, /Choose a month/);
  await refuse({ month: '2026-10-05' }, /Choose a month/);
  await refuse({ month: '2999-01' }, /this month or an earlier one/);
  await refuse({ note: 'x'.repeat(301) }, /300 characters/);
  await refuse({ note: 7 }, /Invalid field note/);
  await refuse({ requestId: 'not-a-uuid' }, /Invalid field requestId/);
  await refuse({ propertyId: 'nope' }, /Invalid field propertyId/);
  await refuse({ ownerId: users[OTHER_OWNER] }, /Unknown or oversized/);
  assert.equal((await rows()).length, stored, 'nothing was stored');
  const edge = await save({ amountMinor: 10000000, category: 'insurance', note: 'x'.repeat(300) });
  assert.equal(edge.amountMinor, 10000000); assert.equal(edge.note.length, 300);
  const spaced = await save({ amountMinor: 1, category: 'other', note: '   padded   ' });
  assert.equal(spaced.note, 'padded');
  // The client-side schema accepts exactly what the database accepts.
  assert.equal(ownerActionSchema.safeParse({ action: 'saveOwnerExpense', requestId: crypto.randomUUID(), propertyId: HARBOUR, month: '2026-10', amountMinor: 2500, category: 'utilities' }).success, true);
  assert.equal(ownerActionSchema.safeParse({ action: 'saveOwnerExpense', requestId: crypto.randomUUID(), propertyId: HARBOUR, month: '2026-10', amountMinor: 0, category: 'utilities' }).success, false);
});

test('only the owner of the property can save or remove: not another owner, not staff', async () => {
  await as(OWNER);
  const mine = await save({ amountMinor: 4200, category: 'utilities', note: 'Electricity' });
  await as(OTHER_OWNER);
  await assert.rejects(save({ propertyId: HARBOUR }), /Property access required/);
  await assert.rejects(remove(mine.id), /no longer there/, 'someone else’s row looks like one that is gone');
  for (const who of [ANNA, ACCOUNTS, ADMIN]) {
    await as(who);
    await assert.rejects(save({ propertyId: HARBOUR }), /Owner access required/);
    await assert.rejects(remove(mine.id), /Owner access required/);
  }
  await asDb();
  assert.equal((await rows()).filter(r => r.id === mine.id).length, 1, 'still there');
  // An owner without the statements tool is refused too, and so is an archived property.
  await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='owner-statements'", [users[OTHER_OWNER]]);
  await as(OTHER_OWNER);
  await assert.rejects(save({ propertyId: OTHER }), /Property access required/);
  await asDb();
  await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'owner-statements')", [users[OTHER_OWNER]]);
  // Removing is the owner's own row, once.
  await as(OWNER);
  assert.deepEqual(await remove(mine.id), { id: mine.id, removed: true });
  await assert.rejects(remove(mine.id), /no longer there/);
  await assert.rejects(rpc('workspace_owner_remove_expense', [{ action: 'removeOwnerExpense', expenseId: 'nope' }]), /Invalid field expenseId/);
  await assert.rejects(rpc('workspace_owner_remove_expense', [{ action: 'removeOwnerExpense', expenseId: mine.id, extra: 1 }]), /Unknown or oversized/);
});

test('a month with an issued or paid statement is locked; a draft does not lock it', async () => {
  await as(OWNER);
  await assert.rejects(save({ month: '2026-09' }), /statement has been issued/, 'September is issued');
  // A draft for Loch Cottage does not lock October; an issued one would.
  await asDb(); await statement(LOCH, '2026-10-01', 'draft');
  await as(OWNER);
  const loch = await save({ propertyId: LOCH, month: '2026-10', amountMinor: 3000, category: 'insurance' });
  const harbour = await save({ propertyId: HARBOUR, month: '2026-10', amountMinor: 700, category: 'supplies' });
  await asDb(); await db.query("update private.workspace_owner_statements set status='issued',issued_at=now() where property_id=$1 and period_start='2026-10-01'", [LOCH]);
  await as(OWNER);
  await assert.rejects(remove(loch.id), /statement has been issued/, 'issuing the statement locks removal');
  await assert.rejects(save({ propertyId: LOCH, month: '2026-10' }), /statement has been issued/);
  assert.equal((await remove(harbour.id)).removed, true, 'Harbour Flat October is not issued, so it can still be removed');
  await asDb(); await db.query("update private.workspace_owner_statements set status='paid' where property_id=$1 and period_start='2026-10-01'", [LOCH]);
  await as(OWNER);
  await assert.rejects(remove(loch.id), /statement has been issued/, 'paid locks as well');
  await asDb(); await db.query("update private.workspace_owner_statements set status='void' where property_id=$1 and period_start='2026-10-01'", [LOCH]);
  await as(OWNER);
  assert.equal((await remove(loch.id)).removed, true, 'a void statement releases the month');
  // Where statements carry an end date, any issued period overlapping the month locks it.
  await asDb();
  await db.query('alter table private.workspace_owner_statements add column if not exists period_end date');
  await db.query(`insert into private.workspace_owner_statements(property_id,period_start,period_end,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
    values($1,'2026-07-01','2026-08-10','issued',1,0,0,0,0,0,1,'{"stays":[],"expenses":[]}'::jsonb,$2,now())`, [LOCH, users[ADMIN]]);
  assert.equal((await db.query("select private.workspace_owner_month_locked($1,'2026-08-01') l", [LOCH])).rows[0].l, true, 'August overlaps the issued period');
  assert.equal((await db.query("select private.workspace_owner_month_locked($1,'2026-09-01') l", [LOCH])).rows[0].l, false);
  assert.equal((await db.query("select private.workspace_owner_month_locked($1,'2026-06-01') l", [LOCH])).rows[0].l, false);
  await as(OWNER);
  await assert.rejects(save({ propertyId: LOCH, month: '2026-08' }), /statement has been issued/);
  assert.equal((await save({ propertyId: LOCH, month: '2026-06', amountMinor: 100, category: 'other' })).month, '2026-06');
  // The replay rule: the stored row is returned even when the month has been issued since.
  const replayId = crypto.randomUUID();
  const kept = await save({ requestId: replayId, propertyId: LOCH, month: '2026-05', amountMinor: 900, category: 'supplies' });
  await asDb();
  await db.query(`insert into private.workspace_owner_statements(property_id,period_start,period_end,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
    values($1,'2026-05-01','2026-06-01','issued',1,0,0,0,0,0,1,'{"stays":[],"expenses":[]}'::jsonb,$2,now())`, [LOCH, users[ADMIN]]);
  await as(OWNER);
  assert.equal((await save({ requestId: replayId, propertyId: LOCH, month: '2026-05', amountMinor: 900, category: 'supplies' })).id, kept.id);
  await assert.rejects(remove(kept.id), /statement has been issued/);
});

test('net equals payout minus the owner’s expenses, and the payout and statement never move', async () => {
  await asDb();
  await db.query('delete from private.workspace_owner_expenses');
  const before = await db.query('select * from private.workspace_owner_statements order by id');
  await as(OWNER);
  let data = await periods('2026-09-01', '2026-10-01');
  const octBefore = cell(data, '2026-10', HARBOUR);
  assert.equal(octBefore.payoutMinor, 55000); assert.equal(octBefore.netMinor, null, 'no expenses recorded: no net figure');
  assert.deepEqual(octBefore.ownerExpenses, []); assert.equal(octBefore.ownerExpensesMinor, 0); assert.equal(octBefore.ownerExpensesLocked, false);
  await save({ amountMinor: 2500, category: 'maintenance', note: 'Boiler service' });
  await save({ amountMinor: 1500, category: 'supplies', note: '' });
  await save({ propertyId: LOCH, amountMinor: 999, category: 'other' });
  data = await periods('2026-09-01', '2026-10-01');
  const oct = cell(data, '2026-10', HARBOUR);
  assert.equal(oct.ownerExpensesMinor, 4000); assert.equal(oct.netMinor, 55000 - 4000);
  assert.equal(oct.payoutMinor, octBefore.payoutMinor, 'the payout is unchanged');
  assert.equal(oct.expensesMinor, octBefore.expensesMinor, 'the statement’s own repairs and expenses are unchanged');
  assert.deepEqual(oct.ownerExpenses.map(e => [e.category, e.amountMinor, e.note]), [['maintenance', 2500, 'Boiler service'], ['supplies', 1500, '']]);
  assert.equal(cell(data, '2026-10', LOCH).payoutMinor, null, 'no agreed terms, no payout');
  assert.equal(cell(data, '2026-10', LOCH).netMinor, null, 'so no net figure either, however much was spent');
  assert.equal(cell(data, '2026-10', LOCH).ownerExpensesMinor, 999);
  // The period maths: net over the months asked for, only when something was recorded.
  const month = summarisePeriod(data.months, ['2026-10'], 2, HARBOUR);
  assert.deepEqual([month.ownerExpensesMinor, month.ownerExpenseCount, month.netMinor, month.payoutMinor], [4000, 2, 51000, 55000]);
  assert.equal(summarisePeriod(data.months, ['2026-09'], 2, HARBOUR).netMinor, null);
  // An issued month keeps its issued payout; expenses recorded before it was issued come off the net.
  await asDb();
  await db.query("insert into private.workspace_owner_expenses(property_id,owner_id,month,category,amount_minor,note,request_id) values($1,$2,'2026-09-01','utilities',3000,'Water',gen_random_uuid())", [HARBOUR, users[OWNER]]);
  await as(OWNER);
  const sep = cell(await periods('2026-09-01', '2026-09-01'), '2026-09', HARBOUR);
  assert.equal(sep.source, 'statement'); assert.equal(sep.payoutMinor, 28000); assert.equal(sep.netMinor, 25000); assert.equal(sep.ownerExpensesLocked, true);
  // Removing an expense takes it off the net; removing the last brings the net figure back to null.
  for (const e of oct.ownerExpenses) await remove(e.id);
  const cleared = cell(await periods('2026-10-01', '2026-10-01'), '2026-10', HARBOUR);
  assert.equal(cleared.netMinor, null); assert.equal(cleared.ownerExpensesMinor, 0);
  await asDb();
  const after = await db.query('select * from private.workspace_owner_statements order by id');
  assert.deepEqual(after.rows, before.rows, 'statements are untouched by owner expenses');
});

test('an owner reads only their own expenses, with no staff names, costs or internal flags', async () => {
  await asDb();
  await db.query('delete from private.workspace_owner_expenses');
  await as(OTHER_OWNER);
  await save({ propertyId: OTHER, amountMinor: 777, category: 'utilities', note: 'Gas' });
  await as(OWNER);
  await save({ amountMinor: 321, category: 'other', note: 'Door key' });
  const raw = await rpc('workspace_owner_periods', ['2026-09-01', '2026-10-01']);
  const text = JSON.stringify(raw);
  for (const name of names.filter((_, i) => i !== OWNER)) assert.equal(text.includes(name.split(' ')[0]), false, name + ' must not appear');
  for (const word of ['createdBy', 'created_by', 'ownerId', 'owner_id', 'requestId', 'request_id', 'internal', 'cleanerCost', 'Gas', 'Other House'])
    assert.equal(text.includes(word), false, word + ' must not appear');
  const data = ownerPeriodsSchema.parse(raw);
  assert.deepEqual(data.properties.map(x => x.propertyName), ['Harbour Flat', 'Loch Cottage']);
  assert.deepEqual(data.months.flatMap(c => c.ownerExpenses ?? []).map(e => e.note).sort(), ['Door key']);
  await as(OTHER_OWNER);
  const theirs = await periods('2026-10-01', '2026-10-01');
  assert.deepEqual(theirs.months.flatMap(c => c.ownerExpenses ?? []).map(e => e.note), ['Gas'], 'each owner sees only their own');
});

test('finance staff can read the owners’ expenses; nobody else can', async () => {
  for (const who of [ACCOUNTS, ADMIN]) {
    await as(who);
    const all = await rpc('workspace_owner_expenses_read');
    assert.ok(all.length >= 2);
    assert.ok(all.every(e => e.propertyName && e.ownerName && e.amountMinor > 0));
    const one = await rpc('workspace_owner_expenses_read', [OTHER, '2026-10-01', '2026-10-31']);
    assert.deepEqual(one.map(e => e.propertyName), ['Other House']);
  }
  for (const who of [OWNER, OTHER_OWNER, ANNA]) { await as(who); await assert.rejects(rpc('workspace_owner_expenses_read'), /Finance access required/); }
  await db.exec('reset role');
  await assert.rejects(db.query("select public.workspace_owner_expenses_read()"), /Finance access required/, 'with no session at all');
});

test('the migration runs twice and leaves one wrapper, one trigger and the same data', async () => {
  await asDb();
  const sql = await fs.readFile('supabase/migrations/20261012120000_owner_expenses.sql', 'utf8');
  const count = (await db.query('select count(*)::int n from private.workspace_owner_expenses')).rows[0].n;
  await db.exec(sql);
  await db.exec(sql);
  assert.equal((await db.query('select count(*)::int n from private.workspace_owner_expenses')).rows[0].n, count);
  const definition = (await db.query("select pg_get_functiondef('private.workspace_owner_periods(date,date)'::regprocedure) d")).rows[0].d;
  assert.equal(definition.split('workspace_owner_cell_with_expenses').length - 1, 1);
  assert.equal(definition.includes('private.workspace_owner_period_cell(p.id'), false);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='private.workspace_owner_expenses'::regclass and tgname='business_write_limit'")).rows[0].n, 1);
  await as(OWNER);
  assert.ok(cell(await periods('2026-10-01', '2026-10-01'), '2026-10', HARBOUR).ownerExpenses);
  await save({ amountMinor: 100, category: 'other' });
  assert.ok(migrations.includes('20261012120000_owner_expenses.sql'));
});
