import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Accounts receivable (20261012110000): invoice rows in the hub link to a stay and a client, and the
// receivable report lists invoices to send, invoices sent but not settled (with what is still owed),
// and direct bookings that still need an invoice. Finance roles only; no staff names.
const MIGRATION = 'supabase/migrations/20261012110000_receivable.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'accounts', 'stays', 'client', 'client'];
const names = ['Person Super', 'Person Admin', 'Person Accounts', 'Person Stays', 'Client Olive', 'Client Other'];
const users = roles.map((_, i) => `e3000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, STAYS, OWNER, OTHER_OWNER] = [0, 1, 2, 3, 4, 5];
const session = i => users[i].replace('e300', 'e400');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `receivable${i}@example.com`]);
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
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const report = ({ propertyId = null, id = null, from = null, to = null, filters = null } = {}) => rpc('workspace_finance_report', ['receivable', propertyId, id, from, to, filters]);
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const day = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Receivable flat', address: '4 Leith Walk, Edinburgh' }]);
const FAR = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Far cottage', address: '9 Harbour Road, Oban' }]);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);
await rpc('workspace_assign_property', [FAR, users[OTHER_OWNER], 'client']);
await sql("update public.workspace_properties set region='Edinburgh' where id=$1", [HOME]);
await sql("update public.workspace_properties set region='Argyll' where id=$1", [FAR]);

const stays = {};
async function stay(key, prop, channel, checkIn, checkOut, payout, status = 'confirmed') {
  const { rows } = await db.query(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,payout_minor)
    values($1,$2,$3,$4,$5,'hostaway',$6,$7) returning id`, [prop, `Stay ${key}`, checkIn, checkOut, status, channel, payout]);
  stays[key] = rows[0].id;
}
await asDb();
await stay('D1', HOME, 'direct', day(10), day(13), 90000);
await stay('D2', HOME, 'direct', day(20), day(22), 64000);
await stay('D3', HOME, 'direct', day(30), day(32), 50000, 'cancelled');
await stay('A1', HOME, 'airbnb', day(15), day(18), 70000);
await stay('OLD', HOME, 'direct', day(-90), day(-87), 40000);
await stay('FAR1', FAR, 'direct', day(12), day(14), 31000);
await stay('SOON', HOME, 'direct', day(-10), day(-8), 27000);

const invoice = (extra = {}) => act({ action: 'saveHubItem', kind: 'invoice', title: 'Invoice for the stay', ...extra });
const hubRow = async id => (await sql('select * from private.workspace_hub_items where id=$1', [id]))[0];
const move = (item, status, extra = {}) => act({ action: 'moveHubItem', id: item.id, version: item.version, status, ...extra });
const ids = rows => rows.map(r => r.itemId);

test('links are validated: the stay, the client and the kind of row', async () => {
  await as(ACCOUNTS);
  const linked = await invoice({ title: 'Direct stay, 4 Leith Walk', reservationId: stays.D1, clientId: users[OWNER], reference: 'INV-1001', amountMinor: 90000, dueOn: day(-5) });
  assert.equal(linked.reservationId, stays.D1);
  assert.equal(linked.clientId, users[OWNER]);
  assert.equal(linked.propertyId, HOME, 'the stay brings its property');
  assert.equal(linked.reference, 'INV-1001');
  const row = await hubRow(linked.id);
  assert.equal(row.reservation_id, stays.D1);
  assert.equal(row.client_id, users[OWNER]);
  await as(ACCOUNTS);
  await assert.rejects(invoice({ reservationId: crypto.randomUUID() }), /Stay not found/);
  await assert.rejects(invoice({ reservationId: stays.D1, propertyId: FAR }), /another property/);
  await assert.rejects(invoice({ clientId: users[STAYS] }), /Choose a client/);
  await assert.rejects(invoice({ clientId: crypto.randomUUID() }), /Choose a client/);
  await assert.rejects(invoice({ propertyId: HOME, clientId: users[OTHER_OWNER] }), /not linked to this property/);
  await assert.rejects(act({ action: 'saveHubItem', kind: 'todo', title: 'Chase the guest', reservationId: stays.D1 }), /Only invoices and AirCover/);
  await assert.rejects(act({ action: 'saveHubItem', kind: 'aircover', title: 'Damage claim', clientId: users[OWNER] }), /Only an invoice/);
  const claim = await act({ action: 'saveHubItem', kind: 'aircover', title: 'Damage at Leith Walk', reservationId: stays.A1 });
  assert.equal(claim.reservationId, stays.A1, 'an AirCover claim can name the stay');
  await as(STAYS);
  await assert.rejects(invoice({ reservationId: stays.D1 }), /cannot keep this kind/);
  // Editing keeps a link that is left out and clears one that is sent as null.
  await as(ACCOUNTS);
  const kept = await act({ action: 'saveHubItem', kind: 'invoice', id: linked.id, version: linked.version, title: 'Direct stay, renamed', amountMinor: 91000 });
  assert.equal(kept.reservationId, stays.D1);
  assert.equal(kept.clientId, users[OWNER]);
  assert.equal(kept.propertyId, HOME);
  const cleared = await act({ action: 'saveHubItem', kind: 'invoice', id: linked.id, version: kept.version, title: 'Direct stay, renamed', amountMinor: 91000, propertyId: HOME, reservationId: null, clientId: null });
  assert.equal(cleared.reservationId, null);
  assert.equal(cleared.clientId, null);
  const relinked = await act({ action: 'saveHubItem', kind: 'invoice', id: linked.id, version: cleared.version, title: 'Direct stay, 4 Leith Walk', amountMinor: 90000, dueOn: day(-5), reference: 'INV-1001', reservationId: stays.D1, clientId: users[OWNER] });
  assert.equal(relinked.reservationId, stays.D1);
  assert.equal(relinked.status, 'to_send');
});

test('payments: settledMinor is the total received, never more than the invoice', async () => {
  await as(ACCOUNTS);
  const sent = await move(await invoice({ title: 'Cleaning pack for the owner', amountMinor: 80000, propertyId: HOME }), 'sent');
  assert.equal(sent.status, 'sent');
  await assert.rejects(move(sent, 'sent', { settledMinor: 80001 }), /more than the invoice/);
  const part = await move(sent, 'sent', { settledMinor: 30000 });
  assert.equal(part.status, 'sent');
  assert.equal(part.settledMinor, 30000);
  const paid = await move(part, 'paid', { settledMinor: 80000 });
  assert.equal(paid.settledMinor, 80000);
  const quick = await move(await invoice({ title: 'Marked paid without a figure', amountMinor: 12000 }), 'paid');
  assert.equal(quick.settledMinor, 12000, 'paid with no figure settles the whole invoice');
  // An AirCover payment still records what it paid.
  const claim = await act({ action: 'saveHubItem', kind: 'aircover', title: 'Claim', amountMinor: 50000 });
  assert.equal((await move(claim, 'paid', { settledMinor: 45000 })).settledMinor, 45000);
});

test('the report lists invoices to send and to settle, with what is still owed', async () => {
  await as(SUPER);
  await sql("delete from private.workspace_hub_items where kind in ('invoice','aircover')");
  await as(ACCOUNTS);
  const a = await invoice({ title: 'Direct stay, 4 Leith Walk', reservationId: stays.D1, clientId: users[OWNER], reference: 'INV-2001', amountMinor: 90000, dueOn: day(-5) });
  const b = await invoice({ title: 'Owner supplies', propertyId: FAR, amountMinor: 25000, reference: 'INV-2002' });
  const c = await move(await invoice({ title: 'Linen replacement', propertyId: HOME, amountMinor: 80000, reference: 'INV-2003', dueOn: day(7) }), 'sent', { settledMinor: 30000 });
  const d = await move(await invoice({ title: 'Setup fee', propertyId: FAR, amountMinor: 60000, reference: 'INV-2004' }), 'sent');
  const done = await move(await move(await invoice({ title: 'Already paid', amountMinor: 11000 }), 'sent'), 'paid', { settledMinor: 11000 });
  const result = await report();
  assert.equal(result.section, 'receivable');
  assert.deepEqual(ids(result.toSend).sort(), [a.id, b.id].sort());
  assert.deepEqual(ids(result.toSettle).sort(), [c.id, d.id].sort());
  assert.ok(!ids(result.toSend).includes(done.id) && !ids(result.toSettle).includes(done.id));
  assert.equal(result.totals.toSendMinor, 115000);
  assert.equal(result.totals.toSettleMinor, 50000 + 60000, 'outstanding is the amount less what was paid');
  assert.equal(result.totals.toSendCount, 2);
  assert.equal(result.totals.toSettleCount, 2);
  const first = result.toSend.find(r => r.itemId === a.id);
  assert.equal(first.propertyName, 'Receivable flat');
  assert.equal(first.address, '4 Leith Walk, Edinburgh');
  assert.equal(first.reference, 'INV-2001');
  assert.equal(first.dueOn, day(-5));
  assert.equal(first.overdue, true);
  assert.equal(first.stayReference, 'Stay D1');
  assert.equal(first.checkIn, day(10));
  assert.equal(first.checkOut, day(13));
  assert.equal(first.clientName, 'Client Olive');
  assert.equal(first.amountMinor, 90000);
  assert.equal(first.outstandingMinor, 90000);
  assert.equal(first.ageDays, 0);
  assert.equal(first.version, a.version);
  assert.ok(first.createdAt && first.updatedAt, 'when it was raised and last changed');
  const part = result.toSettle.find(r => r.itemId === c.id);
  assert.equal(part.settledMinor, 30000);
  assert.equal(part.outstandingMinor, 50000);
  assert.equal(part.amountMinor, 80000);
  assert.equal(part.overdue, false);
  assert.equal(part.sentOn, day(0));
  assert.equal(part.clientName, null);
  assert.equal(result.toSend[0].itemId, a.id, 'the one with a past due date comes first');
  // Narrowed by property, by stay and by filters.
  assert.deepEqual(ids((await report({ propertyId: FAR })).toSend), [b.id]);
  assert.deepEqual(ids((await report({ id: stays.D1 })).toSend), [a.id]);
  assert.deepEqual(ids((await report({ filters: { region: 'argyll' } })).toSettle), [d.id]);
  assert.deepEqual(ids((await report({ filters: { channel: 'direct' } })).toSend), [a.id], 'the channel is the linked stay\'s');
  assert.equal((await report({ filters: { channel: 'airbnb' } })).totals.toSendMinor, 0);
  await assert.rejects(report({ filters: { colour: 'red' } }), /Invalid report filters/);
  await assert.rejects(report({ filters: { channel: 'carrier_pigeon' } }), /Invalid report filters/);
  // Paying the rest takes it off the list.
  const settled = await move(c, 'paid', { settledMinor: 80000 });
  assert.equal(settled.status, 'paid');
  const after = await report();
  assert.deepEqual(ids(after.toSettle), [d.id]);
  assert.equal(after.totals.toSettleMinor, 60000);
});

test('direct bookings with no invoice appear as needing one, and leave once an invoice is linked', async () => {
  await as(SUPER);
  await sql("delete from private.workspace_hub_items where kind in ('invoice','aircover')");
  await as(ACCOUNTS);
  const before = await report();
  const keys = before.needsInvoice.map(s => s.stayReference);
  assert.deepEqual(keys, ['Stay SOON', 'Stay D1', 'Stay FAR1', 'Stay D2'], 'confirmed direct stays from 30 days ago onwards, by check-in');
  const d2 = before.needsInvoice.find(s => s.stayReference === 'Stay D2');
  assert.equal(d2.reservationId, stays.D2);
  assert.equal(d2.totalMinor, 64000, 'the stay\'s total where it is known');
  assert.equal(d2.propertyName, 'Receivable flat');
  assert.equal(d2.address, '4 Leith Walk, Edinburgh');
  assert.equal(d2.checkIn, day(20));
  assert.equal(before.totals.needsInvoiceCount, 4);
  for (const left of ['Stay D3', 'Stay A1', 'Stay OLD']) assert.ok(!keys.includes(left), `${left} is cancelled, not direct or too old`);
  assert.equal((await report({ from: day(-100) })).needsInvoice.some(s => s.stayReference === 'Stay OLD'), true, 'a wider window brings older stays in');
  assert.deepEqual((await report({ propertyId: FAR })).needsInvoice.map(s => s.stayReference), ['Stay FAR1']);
  assert.deepEqual((await report({ id: stays.D2 })).needsInvoice.map(s => s.stayReference), ['Stay D2']);
  assert.deepEqual((await report({ filters: { region: 'Argyll' } })).needsInvoice.map(s => s.stayReference), ['Stay FAR1']);
  assert.deepEqual((await report({ filters: { channel: 'airbnb' } })).needsInvoice, []);
  // An invoice linked to the stay, whatever its state, takes the suggestion away.
  const made = await invoice({ title: 'Direct stay, 4 Leith Walk', reservationId: stays.D2, amountMinor: 64000, reference: 'INV-3001' });
  const linked = await report();
  assert.equal(linked.needsInvoice.some(s => s.stayReference === 'Stay D2'), false);
  assert.equal(linked.totals.needsInvoiceCount, 3);
  assert.ok(ids(linked.toSend).includes(made.id));
  const paid = await move(await move(made, 'sent'), 'paid', { settledMinor: 64000 });
  assert.equal(paid.status, 'paid');
  assert.equal((await report()).needsInvoice.some(s => s.stayReference === 'Stay D2'), false, 'a paid invoice still counts as invoiced');
  // The Record invoice sheet picks from the active clients and the recent stays.
  const options = linked.options;
  assert.deepEqual(options.clients.map(c => c.name), ['Client Olive', 'Client Other']);
  assert.deepEqual(options.clients.find(c => c.name === 'Client Olive').propertyIds, [HOME]);
  assert.ok(options.stays.some(s => s.reservationId === stays.D2 && s.invoiced === true));
  assert.ok(options.stays.some(s => s.reservationId === stays.D1 && s.invoiced === false));
  assert.ok(!options.stays.some(s => s.reservationId === stays.OLD), 'old stays are not offered');
});

test('only finance roles read it, no staff names appear, and the function is not callable directly', async () => {
  for (const who of [SUPER, ADMIN, ACCOUNTS]) { await as(who); assert.equal((await report()).section, 'receivable'); }
  for (const who of [STAYS, OWNER, OTHER_OWNER]) { await as(who); await assert.rejects(report(), /Accounts access required/); }
  await as(ACCOUNTS);
  const text = JSON.stringify(await report());
  for (const staff of names.slice(0, 4)) assert.ok(!text.includes(staff), `${staff} must not appear`);
  assert.ok(!/createdBy|assignee|decidedBy/.test(text));
  await as(ACCOUNTS);
  await assert.rejects(db.query('select private.workspace_report_receivable(null,null,null,null,null)'), /permission denied/);
  await asDb();
  await db.exec('reset role');
  const grants = (await db.query("select has_function_privilege('authenticated','private.workspace_report_receivable(uuid,uuid,date,date,jsonb)','execute') ok")).rows[0].ok;
  assert.equal(grants, false);
});

test('the migration runs twice and leaves each patch in once', async () => {
  const migration = await fs.readFile(MIGRATION, 'utf8');
  await asDb();
  await db.exec(migration);
  await db.exec(migration);
  const count = async (fn, needle) => {
    const { rows } = await db.query(`select pg_get_functiondef('${fn}'::regprocedure) d`);
    return rows[0].d.split(needle).length - 1;
  };
  assert.equal(await count('private.workspace_hub_action(jsonb)', 'link_client:=case when input ? \'clientId\''), 1);
  assert.equal(await count('private.workspace_hub_action(jsonb)', 'created_by,reservation_id,client_id)'), 1);
  assert.equal(await count('private.workspace_hub_action(jsonb)', 'The payment is more than the invoice'), 1);
  assert.equal(await count('private.workspace_hub_view(private.workspace_hub_items)', '\'reservationId\',item.reservation_id'), 1);
  assert.equal((await db.query("select count(*)::int n from pg_constraint where conrelid='private.workspace_hub_items'::regclass and conname like 'workspace_hub_items_%_link_kind'")).rows[0].n, 2);
  await as(ACCOUNTS);
  const again = await invoice({ title: 'After the second run', reservationId: stays.FAR1, amountMinor: 31000 });
  assert.equal(again.reservationId, stays.FAR1);
  assert.equal((await report()).section, 'receivable');
});
