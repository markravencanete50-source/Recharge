import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Every tool in the live app: Accounts confirm payments and issue invoices from tasks (the
// recipient is picked for them), onboarding invoices link themselves, and owners read the mailbox.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { controlsActionSchema } = await vite.ssrLoadModule('/lib/workspace-controls-policy.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'accounts', 'stays', 'client', 'cleans'];
const users = roles.map((_, i) => `99300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9930', '9940');
const [ADMIN, ACCOUNTS, STAYS, OWNER, CLEANER] = [0, 1, 2, 3, 4];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `tools${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Accounts', 'Stays', 'Owner', 'Cleaner'][i]]);
}
const PROP = '99300000-0000-4000-8000-0000000000aa';
await db.query("insert into public.workspace_properties(id,name,created_by,request_id) values($1,'Tools Flat',$2,gen_random_uuid())", [PROP, users[ADMIN]]);
await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$4),($1,$3,'cleaner',$4)", [PROP, users[OWNER], users[CLEANER], users[ADMIN]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) select $1,m from unnest(array['onboarding-invoices','cleans-invoices','owner-statements']) m", [users[ACCOUNTS]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) select $1,m from unnest(array['client-mailbox','client-dashboard']) m", [users[OWNER]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-database')", [users[STAYS]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
// A completed, accepted clean by the cleaner, with the post photographed as the owner allowed.
const cleanWork = (await sql(`with w as (insert into public.workspace_work_items(request_id,property_id,module_id,title,status,assignee_id,created_by,due_on)
  values(gen_random_uuid(),$1,'cleaning-schedule','Checkout clean','completed',$2,$3,current_date) returning id)
  insert into private.workspace_domain_details(work_id,kind,data) select id,'cleaning','{"phase":"accepted","mailPreference":"photograph","mailAction":"photograph","mailNote":"Two letters, photographed and left on the table"}' from w returning work_id`, [PROP, users[CLEANER], users[ADMIN]]))[0].work_id;

test('accounts issue an invoice from their invoice task for a finished clean; the cleaner is the recipient', async () => {
  const issue = reference => rpc('workspace_controls_action', [controlsActionSchema.parse({ action: 'issueOperationInvoice', requestId: crypto.randomUUID(), propertyId: PROP, workId: cleanWork, reference, amountMinor: 4500 })]);
  await as(ACCOUNTS);
  await assert.rejects(issue('CLN-000'), /Invoice work access required/, 'no invoice task yet');
  await sql(`with w as (insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'cleans-invoices','Invoice accepted property clean',$2) returning id)
    insert into private.workspace_domain_details(work_id,kind,data) select id,'cleaning_invoice',jsonb_build_object('sourceWorkId',$3::text,'cleanerId',$4::text) from w`, [PROP, users[ADMIN], cleanWork, users[CLEANER]]);
  await as(ACCOUNTS);
  await as(ACCOUNTS);
  const result = await issue('CLN-001');
  const [invoice] = await sql('select recipient_id,module_id,status from public.workspace_invoices where id=$1', [result.invoiceId]);
  assert.deepEqual(invoice, { recipient_id: users[CLEANER], module_id: 'cleans-invoices', status: 'issued' });
});

test('accounts confirm payments for their invoices; Stays cannot', async () => {
  const [invoice] = await sql("select id,version from public.workspace_invoices where reference='CLN-001'");
  await as(STAYS);
  await assert.rejects(rpc('workspace_set_invoice_status', [invoice.id, invoice.version, 'paid']), /payment confirmation required/);
  await as(ACCOUNTS);
  await rpc('workspace_set_invoice_status', [invoice.id, invoice.version, 'paid']);
  assert.equal((await sql('select status from public.workspace_invoices where id=$1', [invoice.id]))[0].status, 'paid');
});

test('an onboarding invoice links itself to the signed onboarding', async () => {
  const work = (await sql(`insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'property-onboarding','Onboarding',$2) returning id`, [PROP, users[ADMIN]]))[0].id;
  await sql(`insert into private.workspace_journeys(property_id,client_id,work_id,stage,property_type,bathrooms,signed_at,submitted_at,form) values($1,$2,$3,'invoice','flat',1,now(),now(),'{}')`, [PROP, users[OWNER], work]);
  await as(ACCOUNTS);
  const invoiceId = await rpc('workspace_create_invoice', [{ requestId: crypto.randomUUID(), propertyId: PROP, moduleId: 'onboarding-invoices', recipientId: users[OWNER], reference: 'ONB-001', amountMinor: 25000, currency: 'GBP' }]);
  assert.equal((await sql('select invoice_id from private.workspace_journeys where property_id=$1', [PROP]))[0].invoice_id, invoiceId);
  // Settling it moves the onboarding on to the inspection.
  await as(ACCOUNTS);
  await rpc('workspace_set_invoice_status', [invoiceId, 1, 'paid']);
  assert.equal((await sql('select stage from private.workspace_journeys where property_id=$1', [PROP]))[0].stage, 'inspection_to_book');
});

test('owners read what the cleaner did with their post; other roles cannot', async () => {
  await as(OWNER);
  const mail = await rpc('workspace_teams_read', ['mailbox', null, null, null, null]);
  assert.deepEqual(mail.map(m => [m.propertyName, m.action, m.note]), [['Tools Flat', 'photograph', 'Two letters, photographed and left on the table']]);
  await as(CLEANER);
  await assert.rejects(rpc('workspace_teams_read', ['mailbox', null, null, null, null]), /Mailbox access required/);
  // The cleaner's note is accepted with the clean report.
  assert.equal(operationsActionSchema.parse({ action: 'updateOperation', requestId: crypto.randomUUID(), workId: cleanWork, version: 1, step: 'submitCleaning',
    data: { checks: ['Beds'], report: 'All done', photoIds: [crypto.randomUUID()], mailAction: 'photograph', mailNote: 'One parcel' } }).data.mailNote, 'One parcel');
});
