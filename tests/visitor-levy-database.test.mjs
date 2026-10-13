import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Visitor levy on owner statements (20261014150000): per-property settings, one line per levied stay straight after
// the OTA fees, the fee charged after the levy, shared across periods by its levied nights, kept on the stored copy
// once a statement is issued, refused at issue when a setting changed since the draft, and shown to owners.
// The SQL must give exactly the figures of statementFor in lib/statement-maths.ts. The example is the levy worked
// example of tests/statement-maths.test.mjs, a year earlier so the periods have started.
const MIGRATION = 'supabase/migrations/20261014150000_visitor_levy.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { statementFor } = await vite.ssrLoadModule('/lib/statement-maths.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'accounts', 'client'];
const users = roles.map((_, i) => `d5000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [, ADMIN, ACCOUNTS, OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `levy${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('d500', 'd600'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('d500', 'd600'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('d500', 'd600') })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const compute = async (prop, from, to, method = 'nights') => (await sql('select private.workspace_statement_compute($1,$2,$3,$4,null) c', [prop, from, to, method]))[0].c;
const EDINBURGH = { enabled: true, rateBps: 500, nightCap: 5, from: '2025-07-24' };
const terms = (propertyId, visitorLevy) => finance({ action: 'setStatementTerms', propertyId, managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee', ...(visitorLevy ? { visitorLevy } : {}) });
async function property(name) {
  const id = (await sql('insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id', [name, users[ADMIN]]))[0].id;
  await sql("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)", [id, users[OWNER], users[ADMIN]]);
  return id;
}
async function stay(prop, reference, channel, code, checkIn, checkOut, payout) {
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,'confirmed','manual',$5,$6,$7) returning id`, [prop, reference, checkIn, checkOut, channel, code, payout]))[0].id;
}
const line = (channel, reference, amountMinor, { hostFee = null, cleaningFee = null } = {}) => ({
  reference, amountMinor, grossMinor: null, commissionMinor: null, hostFeeMinor: hostFee, paymentFeeMinor: null, cleaningFeeMinor: cleaningFee,
  paidOn: '2025-11-30', lineType: 'Reservation', key: [channel, reference.toUpperCase(), '2025-11-30', 'Reservation', amountMinor, 'PO-L', 1].join('|'),
});
// The figures statementFor and the SQL share, levy included.
const figures = r => ({ grossMinor: r.grossMinor, otaFeesMinor: r.otaFeesMinor, visitorLevyMinor: r.visitorLevyMinor, changeoversMinor: r.changeoversMinor, feeBaseMinor: r.feeBaseMinor,
  feeMinor: r.feeMinor, vatMinor: r.vatMinor, payoutMinor: r.payoutMinor, flags: r.flags, blocked: r.blocked,
  lines: r.lines.map(l => [l.kind, l.refId, l.amountMinor, l.date, l.label]),
  stays: r.stays.map(s => [s.id ?? s.reservationId, s.counted, s.grossMinor, s.levyMinor]) });

const HOME = await property('Levy flat');
const AIR = await stay(HOME, 'Airbnb stay', 'airbnb', 'HMLEVY0001', '2025-11-05', '2025-11-09', 50000);
const DIR = await stay(HOME, 'Direct stay', 'direct', null, '2025-11-28', '2025-12-05', 70000);
await as(ADMIN);
await terms(HOME, EDINBURGH);
await as(ACCOUNTS);
await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-levy.csv', lines: [line('airbnb', 'HMLEVY0001', 50000, { hostFee: 1546, cleaningFee: 6000 })] });
const tsStays = [
  { id: AIR, channel: 'airbnb', checkIn: '2025-11-05', checkOut: '2025-11-09', status: 'confirmed', settledMinor: 50000, itemisedFeesMinor: 1546, cleaningFeeMinor: 6000 },
  { id: DIR, channel: 'direct', checkIn: '2025-11-28', checkOut: '2025-12-05', status: 'confirmed', settledMinor: 70000 },
];
const tsTerms = levy => ({ managementFeeBps: 1500, vatOnFee: true, cleaningCostMinor: 6000, cleanChargeMode: 'agreed_fee', visitorLevy: levy });
let november;

test('the levy settings are per property, checked, and shown with the terms', async () => {
  await as(ADMIN);
  const other = await property('No levy flat');
  await as(ADMIN);
  const plain = await terms(other);
  assert.equal(plain.visitorLevy, undefined, 'callers that leave it out get the reply they had');
  for (const [bad, message] of [[{ rateBps: 500 }, /Choose whether the visitor levy is charged/], [{ enabled: 'yes' }, /Choose whether/], [{ enabled: true, rateBps: 10001 }, /visitor levy rate/],
    [{ enabled: true, nightCap: 0 }, /most nights levied/], [{ enabled: true, nightCap: 400 }, /most nights levied/], [{ enabled: true, from: '2025-13-01' }, /dates/], [{ enabled: true, council: 'Edinburgh' }, /Invalid visitor levy/]]) {
    await assert.rejects(terms(other, bad), message, JSON.stringify(bad));
  }
  const set = await terms(other, { enabled: true, rateBps: 300, nightCap: null, from: null });
  assert.deepEqual(set.visitorLevy, { enabled: true, rateBps: 300, nightCap: null, from: null, feeAfterLevy: true });
  // Leaving keys out keeps them; switching it off keeps the rate for next time.
  assert.deepEqual((await terms(other, { enabled: false })).visitorLevy, { enabled: false, rateBps: 300, nightCap: null, from: null, feeAfterLevy: true });
  await as(ACCOUNTS);
  await assert.rejects(terms(other, { enabled: true }), /Management access required/, 'only management sets the terms');
  const list = await rpc('workspace_finance_read', ['statements', null, '2025-11', null, null]);
  assert.deepEqual(list.find(p => p.propertyId === HOME).terms.visitorLevy, { ...EDINBURGH, feeAfterLevy: true });
  assert.deepEqual(list.find(p => p.propertyId === other).terms.visitorLevy, { enabled: false, rateBps: 300, nightCap: null, from: null, feeAfterLevy: true });
});

test('worked example: November levies both stays after the OTA fees and charges the fee after the levy, as statementFor', async () => {
  const c = await compute(HOME, '2025-11-01', '2025-12-01');
  assert.deepEqual(c.lines.map(l => [l.kind, l.refId, l.amountMinor]), [
    ['ota_fee', AIR, 1546], ['visitor_levy', AIR, 2277], ['visitor_levy', DIR, 1500], ['management_fee', null, 11433], ['vat', null, 2287],
  ]);
  assert.deepEqual([c.grossMinor, c.visitorLevyMinor, c.feeBaseMinor, c.payoutMinor], [81546, 3777, 76223, 62503]);
  assert.deepEqual(c.terms.visitorLevy, { ...EDINBURGH, feeAfterLevy: true });
  assert.deepEqual(figures(c), figures(statementFor({ from: '2025-11-01', to: '2025-12-01', method: 'nights', terms: tsTerms({ ...EDINBURGH }), stays: tsStays, cleans: [], payables: [] })));
  // The stored copy it would keep: the whole levy and its levied nights.
  const d = c.stays.find(s => s.reservationId === DIR);
  assert.deepEqual([d.levyMinor, d.stayLevyMinor, d.stayLevyNights], [1500, 2500, 5]);
  await as(ACCOUNTS);
  november = await finance({ action: 'prepareStatement', propertyId: HOME, period: '2025-11' });
  assert.equal(november.payoutMinor, 62503);
  assert.equal(november.detail.visitorLevyMinor, 3777);
  await finance({ action: 'issueStatement', statementId: november.id, version: november.version });
});

test('December takes the rest of the levy from the stored copy, whatever the settings say now', async () => {
  await as(ADMIN);
  await terms(HOME, { ...EDINBURGH, rateBps: 700, nightCap: null });
  const c = await compute(HOME, '2025-12-01', '2026-01-01');
  assert.deepEqual(c.lines.filter(l => l.kind === 'visitor_levy').map(l => [l.refId, l.amountMinor]), [[DIR, 1000]], 'the copy: 2500 over 5 nights, 2 of them in December');
  const stored = { grossMinor: 70000, otaFeeMinor: 0, settledMinor: 70000, nights: 7, checkIn: '2025-11-28', checkOut: '2025-12-05', levyMinor: 2500, levyNights: 5 };
  assert.deepEqual(figures(c), figures(statementFor({ from: '2025-12-01', to: '2026-01-01', method: 'nights', terms: tsTerms({ ...EDINBURGH, rateBps: 700, nightCap: null }), cleans: [], payables: [],
    stays: [{ ...tsStays[1], storedShare: stored }] })));
  await as(ADMIN);
  await terms(HOME, EDINBURGH);
});

test('issuing refuses a draft whose levy setting changed since it was prepared', async () => {
  await as(ADMIN);
  const flat = await property('Draft levy flat');
  await as(ADMIN);
  await terms(flat, EDINBURGH);
  await stay(flat, 'Direct', 'direct', null, '2025-10-10', '2025-10-13', 30000);
  await as(ACCOUNTS);
  const draft = await finance({ action: 'prepareStatement', propertyId: flat, period: '2025-10' });
  assert.equal(draft.detail.visitorLevyMinor, 1500);
  await as(ADMIN);
  await terms(flat, { ...EDINBURGH, rateBps: 600 });
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'issueStatement', statementId: draft.id, version: draft.version }), /Figures changed, prepare the statement again/);
  const again = await finance({ action: 'prepareStatement', propertyId: flat, period: '2025-10' });
  assert.equal(again.detail.visitorLevyMinor, 1800);
});

test('the owner sees the levy line and its total on the issued statement', async () => {
  await as(OWNER);
  const mine = await rpc('workspace_finance_read', ['statements', null, null, null, null]);
  const s = mine.find(x => x.id === november.id);
  assert.ok(s);
  assert.deepEqual(s.detail.lines.filter(l => l.kind === 'visitor_levy').map(l => [l.label, l.amountMinor]), [['Visitor levy', 2277], ['Visitor levy', 1500]]);
  assert.equal(s.detail.visitorLevyMinor, 3777);
  assert.equal(s.detail.internal, undefined);
});

test('the levy is off by default, and the migration runs twice without changing a definition', async () => {
  assert.deepEqual((await sql("select column_default d from information_schema.columns where table_schema='private' and table_name='workspace_property_financials' and column_name in ('levy_enabled','levy_rate_bps') order by column_name"))
    .map(r => r.d), ['false', '500']);
  const fns = ['private.workspace_statement_compute(uuid,date,date,text,uuid)', 'private.workspace_statement_entry(jsonb)', 'private.workspace_statement_money(jsonb)',
    'private.workspace_prepare_statement_v2(jsonb)', 'private.workspace_set_statement_terms(jsonb)', 'private.workspace_finance_read(text,uuid,text,uuid,text)'];
  const read = () => Promise.all(fns.map(async fn => (await sql('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d));
  const before = await read();
  await asDb(); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.deepEqual(await read(), before);
  for (const fn of ['private.workspace_levy_minor(bigint,integer,integer,integer)', 'private.workspace_set_visitor_levy(uuid,jsonb)', 'private.workspace_stay_cleaning_fee(private.workspace_reservations)'])
    assert.equal((await sql("select has_function_privilege('authenticated',$1::regprocedure,'execute') a", [fn]))[0].a, false, fn);
});
