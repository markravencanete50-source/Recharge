import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Last update on each piece of work: the person who made the latest change and what it was,
// nobody for automatic changes, and never a staff name for owners.
const MIGRATION = 'supabase/migrations/20261012070000_work_last_update.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { operationViewSchema, propertyViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const db = new PGlite();
const roles = ['super_admin', 'accounts', 'stays', 'client', 'ready'];
const names = ['Admin', 'Aileen Accounts', 'Sam Stays', 'Owen Owner', 'Rory Ready'];
const [ADMIN, ACCOUNTS, STAYS, CLIENT, READY] = roles.map((_, i) => i);
const users = roles.map((_, i) => `83000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('8300', '8400');
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `last-update${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]); await db.exec('set role authenticated'); }
// Trusted database work with nobody signed in, like the Hostaway sync.
async function automatic() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(async () => { await db.close(); await vite.close(); });
const action = async input => (await db.query('select public.workspace_operations_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const accounts = async input => (await db.query('select public.workspace_accounts_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const team = async input => (await db.query('select public.workspace_teams_action($1::jsonb) result', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].result;
const update = (w, step, data) => action({ action: 'updateOperation', workId: w.workId, version: w.version, step, data });
// The item as the signed-in person's work list returns it, through the app's schema.
const read = async (i, workId) => { await as(i); const items = (await db.query('select public.workspace_operations_read($1) data', [property])).rows[0].data; return operationViewSchema.parse(items.find(w => w.workId === workId)); };

await as(ADMIN);
const property = (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name: 'Last update flat', address: '1 Test Street', region: 'Glasgow', bedrooms: 2 })])).rows[0].id;
for (const [i, assignment] of [[STAYS, 'staff'], [CLIENT, 'client'], [READY, 'staff']]) await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[i], assignment]);
await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
await as(ACCOUNTS);
const chair = await team({ action: 'saveBudgetItem', item: 'Dining chair', maxUnitMinor: 6000 });
await as(STAYS);
let purchase = await action({ action: 'createOperation', propertyId: property, kind: 'purchase', data: { requirements: 'Two dining chairs, one broke', budgetMinor: 15000 } });

test('the approver name and the step appear once a step is recorded', async () => {
  let seen = await read(ACCOUNTS, purchase.workId);
  assert.equal(seen.updatedBy, 'Sam Stays'); assert.equal(seen.updatedEvent, 'operations.createOperation');
  await as(ACCOUNTS);
  purchase = await update(purchase, 'approvePurchase', { approvedAmountMinor: 11000, approvalNote: 'Two chairs within the chart', budgetItemId: chair.id, quantity: 2 });
  seen = await read(STAYS, purchase.workId);
  assert.equal(seen.updatedBy, 'Aileen Accounts');
  // The step wrote a trigger row and a named event at the same instant; the named one wins.
  await db.exec('reset role');
  const rows = (await db.query("select event_type from public.workspace_activity where work_id=$1 and created_at=(select max(created_at) from public.workspace_activity where work_id=$1) order by id", [purchase.workId])).rows.map(r => r.event_type);
  assert.ok(rows.includes('workspace_work_items.update') && rows.includes('operations.updateOperation.approvePurchase'), rows.join());
  assert.equal(seen.updatedEvent, 'operations.updateOperation.approvePurchase');
  assert.equal(seen.data.phase, 'approved');
  // Still the named event when the trigger row is written after it in the same change.
  await as(ACCOUNTS); await db.exec('reset role');
  await db.exec('begin');
  await db.query("insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,'operations.updateOperation.addNote')", [users[ACCOUNTS], property, purchase.workId]);
  await db.query('update public.workspace_work_items set updated_at=now() where id=$1', [purchase.workId]);
  await db.exec('commit');
  seen = await read(STAYS, purchase.workId);
  assert.equal(seen.updatedEvent, 'operations.updateOperation.addNote'); assert.equal(seen.updatedBy, 'Aileen Accounts');
});

test('an automatic change has no name', async () => {
  await automatic();
  await db.query("update public.workspace_work_items set title=title||' (synced)' where id=$1", [purchase.workId]);
  for (const i of [ACCOUNTS, STAYS]) {
    const seen = await read(i, purchase.workId);
    assert.equal(seen.updatedBy, null, roles[i]); assert.equal(seen.updatedEvent, 'workspace_work_items.update');
  }
  // Work nobody has touched since the activity log began still reads cleanly.
  // Work with no activity rows at all (older data) still reads cleanly.
  await automatic();
  const old = (await db.query("insert into public.workspace_work_items(property_id,module_id,title,status,created_by,request_id) select property_id,module_id,'Old chair order','waiting',created_by,gen_random_uuid() from public.workspace_work_items where id=$1 returning id", [purchase.workId])).rows[0].id;
  await db.query("insert into private.workspace_domain_details(work_id,kind,data) values($1,'purchase','{\"phase\":\"requested\"}')", [old]);
  await db.query('delete from private.workspace_notification_outbox where work_id=$1', [old]);
  await db.query('delete from public.workspace_activity where work_id=$1', [old]);
  const bare = await read(ACCOUNTS, old);
  assert.equal(bare.updatedBy, null); assert.equal(bare.updatedEvent, null); assert.equal(bare.lastActivityAt, null);
});

test('owners see the change but no staff name, and their copy is still stripped', async () => {
  await as(ACCOUNTS);
  purchase = (await read(ACCOUNTS, purchase.workId));
  await as(ACCOUNTS);
  purchase = await update(purchase, 'recordOrder', { orderReference: 'ORDER-88', supplier: 'Test supplier' });
  await automatic();
  await db.query(`update private.workspace_domain_details set data=data||'{"troubleshooting":"Staff only notes","guestEvidence":"Staff only","reservationId":"R-1"}' where work_id=$1`, [purchase.workId]);
  const staff = await read(STAYS, purchase.workId);
  assert.equal(staff.updatedBy, 'Aileen Accounts'); assert.equal(staff.updatedEvent, 'operations.updateOperation.recordOrder');
  assert.equal(staff.data.troubleshooting, 'Staff only notes');
  const owner = await read(CLIENT, purchase.workId);
  assert.equal(owner.updatedBy, null, 'owners never see a staff name');
  assert.equal(owner.updatedEvent, null, 'owners never see the staff step either');
  assert.equal(owner.updatedAt, staff.updatedAt);
  assert.ok(owner.lastActivityAt, 'owners still get the time of the last change');
  assert.equal(owner.lastActivityAt, staff.lastActivityAt);
  for (const key of ['troubleshooting', 'guestEvidence', 'reservationId', 'warrantyContactEvidence']) assert.equal(key in owner.data, false, key);
  assert.equal(owner.data.phase, 'ordered');
});

test('an invoice recorded after delivery moves the time on with the person', async () => {
  // Delivery by Ready, then Accounts record the supplier invoice. That step logs activity but does not touch updated_at.
  await automatic();
  const photo = (await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at,provider_asset_id,asset_format,asset_bytes,asset_version) values($1,$2,$3,'delivery','TEST-'||gen_random_uuid(),now(),'storage:test.jpg','jpg',2048,1) returning id", [property, purchase.workId, users[READY]])).rows[0].id;
  await as(READY);
  purchase = await update(purchase, 'recordDelivery', { receivedOn: new Date().toISOString().slice(0, 10), evidence: 'Two chairs arrived, boxed and undamaged', photoIds: [photo] });
  const delivered = await read(STAYS, purchase.workId);
  assert.equal(delivered.updatedBy, 'Rory Ready'); assert.equal(delivered.updatedEvent, 'operations.updateOperation.recordDelivery');
  assert.equal(delivered.lastActivityAt, delivered.updatedAt, 'a step that updates the item moves both together');
  await as(ACCOUNTS);
  const invoice = await accounts({ action: 'recordPurchaseInvoice', purchaseId: purchase.workId, reference: 'CHAIRS-7', amountMinor: 10500, paid: true });
  assert.equal(invoice.status, 'paid');
  const staff = await read(STAYS, purchase.workId);
  assert.equal(staff.updatedBy, 'Aileen Accounts'); assert.equal(staff.updatedEvent, 'finance.purchase_invoice_recorded');
  assert.equal(staff.updatedAt, delivered.updatedAt, 'recording the invoice does not touch updated_at');
  assert.ok(Date.parse(staff.lastActivityAt) > Date.parse(staff.updatedAt), 'the activity is later than the item');
  // Owners get the same time but no name and no step.
  const owner = await read(CLIENT, purchase.workId);
  assert.equal(owner.updatedBy, null); assert.equal(owner.updatedEvent, null);
  assert.equal(owner.lastActivityAt, staff.lastActivityAt); assert.equal(owner.updatedAt, staff.updatedAt);
});

test('the migration runs twice cleanly and keeps the grants', async () => {
  await db.exec('reset role');
  const grants = async () => (await db.query("select has_function_privilege('authenticated','private.workspace_operation_view(uuid)','execute') view, has_function_privilege('anon','private.workspace_operation_view(uuid)','execute') anon, has_function_privilege('authenticated','public.workspace_operations_read(uuid)','execute') reader")).rows[0];
  const before = await grants();
  assert.deepEqual(before, { view: false, anon: false, reader: true });
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await grants(), before);
  assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname='workspace_activity_work_latest_idx'")).rows[0].n, 1);
  const after = await read(STAYS, purchase.workId), owner = await read(CLIENT, purchase.workId);
  assert.equal(after.updatedBy, 'Aileen Accounts'); assert.ok(Date.parse(after.lastActivityAt) > Date.parse(after.updatedAt));
  assert.equal(owner.updatedBy, null); assert.equal(owner.updatedEvent, null); assert.equal(owner.lastActivityAt, after.lastActivityAt);
});

test('the property schema carries the last change', () => {
  const row = { id: property, name: 'Flat', address: '1 Test Street', region: 'Glasgow', status: 'active', version: 1, bedrooms: 2, created_at: '2026-10-01T09:00:00+00:00', updated_at: '2026-10-12T13:05:00+00:00' };
  assert.equal(propertyViewSchema.parse(row).updatedAt, '2026-10-12T13:05:00+00:00');
  assert.equal('updated_at' in propertyViewSchema.parse(row), false);
  assert.equal('updatedAt' in propertyViewSchema.parse({ ...row, updated_at: undefined }), false, 'still optional');
  assert.equal(propertyViewSchema.parse(propertyViewSchema.parse(row)).updatedAt, row.updated_at, 'a parsed copy parses again');
});
