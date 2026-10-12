import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Regressions for the money and privacy defects found in the 12 October review of the Accounts build
// (migrations 20261012080000 to 20261012130000). Each test asserts the fixed behaviour:
//  M1  a stay approved before its funds arrived, paid differently after its first period was issued, no longer
//      blocks every later statement: later periods take their share from the copy stored at the first issue.
//  M2  a stay moved or extended after its first period was issued is never shared out again at its new length.
//  M3  a legacy monthly draft that a later statement relies on cannot be prepared again (or voided) in a way
//      that leaves part of a stay's money on no statement; the screen keeps the draft's own method.
//  M4  an issued period that starts on the 1st locks only its own days, not the rest of the month.
//  M6  bulk approval never agrees a payout whose lines repeat an amount (often an overlapping upload).
//  M7  a stay shared by nights on one statement and by check-in on another is refused, both ways round.
//  X1  issuing works the draft out again and refuses if the figures have changed since it was prepared.
//  X2  an invoice moved to another property keeps its client only when that client is on the new property.
//  X3  the preview lists stays whose money changed after an issued statement stored its copy.
//  S1  the owner's months are never estimated where a statement of other dates covers them, each statement
//      counts once, and estimates take VAT on the fee off the payout.
//  S4  owner expenses are read only by finance staff who have the owner statements tool.
// The database starts with every migration before 20261012080000 and legacy finance data written by the legacy
// functions, then the six migrations are applied, and applied again (a second run must change nothing).
const MIGRATIONS = 'supabase/migrations/';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { statementFor } = await vite.ssrLoadModule('/lib/statement-maths.ts');
const { ownerPeriodsSchema, summarisePeriod, coverNotes } = await vite.ssrLoadModule('/lib/owner-periods.ts');
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

const files = (await fs.readdir(MIGRATIONS)).filter(f => f.endsWith('.sql')).sort();
const earlier = files.filter(f => f < '20261012080000');
const fresh = files.filter(f => f >= '20261012080000' && f < '20261012140000');
assert.equal(fresh.length, 6, 'the six migrations under test');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const f of earlier) await db.exec(await fs.readFile(MIGRATIONS + f, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'accounts', 'client', 'client', 'accounts'];
const users = roles.map((_, i) => `e5000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [, ADMIN, ACCOUNTS, OWNER, OTHER_OWNER, BARE_ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('e500', 'e600');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `regressions${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  // Everyone has every tool, except the accounts user kept bare for S4.
  if (i !== BARE_ACCOUNTS) await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
let current = null;
async function as(i) {
  current = i;
  await db.exec('reset role');
  await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const teams = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const report = (section, { propertyId = null, id = null, from = null, to = null, filters = null } = {}) => rpc('workspace_finance_report', [section, propertyId, id, from, to, filters]);
// Database-side reads and writes; the caller's role is put back afterwards.
const sql = async (text, args = []) => { await asDb(); const rows = (await db.query(text, args)).rows; if (current !== null) await as(current); return rows; };
const one = async (text, args = []) => (await sql(text, args))[0];
const version = async id => (await one('select version from private.workspace_reservations where id=$1', [id])).version;
const statementVersion = async id => (await one('select version from private.workspace_owner_statements where id=$1', [id])).version;
const compute = async (prop, from, to, method = 'nights') => (await one('select private.workspace_statement_compute($1,$2,$3,$4,null) c', [prop, from, to, method])).c;
const payoutRow = async id => (await one('select private.workspace_payout_row(r) p from private.workspace_reservations r where id=$1', [id])).p;
const entry = (statement, id) => statement.detail.stays.find(x => x.reservationId === id);
async function property(name) {
  return (await one('insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id', [name, users[ADMIN]])).id;
}
async function stay(prop, reference, channel, code, checkIn, checkOut, payout) {
  return (await one(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,'confirmed','manual',$5,$6,$7) returning id`, [prop, reference, checkIn, checkOut, channel, code, payout])).id;
}
const line = (reference, amountMinor, key, over = {}) => ({ reference, amountMinor, grossMinor: null, commissionMinor: null, hostFeeMinor: null, paymentFeeMinor: null, cleaningFeeMinor: null, paidOn: '2025-11-30', lineType: 'Reservation', key, ...over });
const terms = (propertyId, over = {}) => finance({ action: 'setStatementTerms', propertyId, managementFeeBps: 1500, cleaningCostMinor: 6000, ...over });
const fnDefs = async () => Object.fromEntries((await sql(`select p.oid::regprocedure::text n,pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname in ('private','public') and p.prokind='f'`)).map(r => [r.n, r.d]));
const conDefs = async () => (await sql(`select conrelid::regclass::text t,conname,pg_get_constraintdef(oid) d from pg_constraint where connamespace in ('private'::regnamespace,'public'::regnamespace) order by 1,2`)).map(r => `${r.t}.${r.conname}: ${r.d}`);

// ---- Legacy data, written by the legacy functions before the six migrations exist ---------------------------
const LEG = await property('Legacy flat');
const LEG_STAY = await stay(LEG, 'Oct into Nov', 'airbnb', 'HMOCT00001', '2025-10-28', '2025-11-03', 60000);
await as(ADMIN);
await terms(LEG);
await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'legacy-oct.csv', lines: [{ reference: 'HMOCT00001', amountMinor: 60000 }] });
const legacyOct = await finance({ action: 'prepareStatement', propertyId: LEG, period: '2025-10' });
assert.deepEqual([legacyOct.status, legacyOct.revenueMinor], ['draft', 60000]);
const ISS = await property('Legacy issued flat');
const ISS_STAY = await stay(ISS, 'Oct into Nov issued', 'airbnb', 'HMOCT00002', '2025-10-28', '2025-11-03', 60000);
await as(ADMIN);
await terms(ISS);
await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'legacy-oct-2.csv', lines: [{ reference: 'HMOCT00002', amountMinor: 60000 }] });
const issOct = await finance({ action: 'prepareStatement', propertyId: ISS, period: '2025-10' });
assert.equal((await finance({ action: 'issueStatement', statementId: issOct.id, version: issOct.version })).status, 'issued');

await asDb();
current = null;
for (const f of fresh) await db.exec(await fs.readFile(MIGRATIONS + f, 'utf8'));
const defs1 = await fnDefs(), cons1 = await conDefs();
for (const f of fresh) await db.exec(await fs.readFile(MIGRATIONS + f, 'utf8'));
const defs2 = await fnDefs(), cons2 = await conDefs();

test('the six migrations apply over legacy finance data, and a second run changes nothing', async () => {
  assert.deepEqual(Object.keys(defs1).filter(k => defs1[k] !== defs2[k]), [], 'function definitions changed on the second run');
  assert.deepEqual(cons2, cons1, 'constraints changed on the second run');
  const st = await one('select period_start::text,period_end::text,method,status from private.workspace_owner_statements where id=$1', [legacyOct.id]);
  assert.deepEqual(st, { period_start: '2025-10-01', period_end: '2025-11-01', method: 'check_in_month', status: 'draft' });
});

test('M3: a legacy monthly draft a later statement relies on keeps counting the stay in full', async () => {
  await as(ACCOUNTS);
  // November leaves the stay to the October draft, which counts it in full where it checks in.
  const nov = await finance({ action: 'prepareStatement', propertyId: LEG, period: '2025-11' });
  assert.deepEqual(nov.detail.alreadyCounted, [LEG_STAY]);
  assert.deepEqual([entry(nov, LEG_STAY).counted, entry(nov, LEG_STAY).grossMinor, entry(nov, LEG_STAY).nightsInPeriod], [false, 0, 2]);
  await finance({ action: 'issueStatement', statementId: nov.id, version: nov.version });
  // Asking for October by nights would count 4 of its 6 nights, leaving 2 nights of money on no statement.
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: LEG, period: '2025-10', method: 'nights' }), /A statement prepared later leaves a stay to this period to count in full/);
  assert.deepEqual((await one("select private.workspace_statement_compute($1,'2025-10-01','2025-11-01','nights',$2) c", [LEG, legacyOct.id])).c.blockedReasons, [`stay_relied_on:${LEG_STAY}`]);
  // The legacy draft has none of the version 2 detail: issuing it as it stands is refused (X1).
  await assert.rejects(finance({ action: 'issueStatement', statementId: legacyOct.id, version: await statementVersion(legacyOct.id) }), /Figures changed, prepare the statement again/);
  // Preparing it again the way the screen now does (no method named) keeps its own method: the whole stay.
  const oct = await finance({ action: 'prepareStatement', propertyId: LEG, period: '2025-10' });
  assert.equal(oct.id, legacyOct.id);
  assert.equal(oct.method, 'check_in_month');
  assert.deepEqual([entry(oct, LEG_STAY).counted, entry(oct, LEG_STAY).grossMinor, entry(oct, LEG_STAY).wholeStay], [true, 60000, true]);
  assert.equal(entry(oct, LEG_STAY).grossMinor + entry(nov, LEG_STAY).grossMinor, 60000, 'the whole stay is on exactly one statement');
  const issued = await finance({ action: 'issueStatement', statementId: oct.id, version: oct.version });
  assert.equal(issued.status, 'issued');
  // Voiding October now would leave the stay's money on no statement: November has to be voided first.
  await as(ADMIN);
  await assert.rejects(finance({ action: 'voidStatement', statementId: oct.id, version: issued.version, reason: 'Redo October' }), /Void the later statement first/);
  const novNow = await statementVersion(nov.id);
  await finance({ action: 'voidStatement', statementId: nov.id, version: novNow, reason: 'Redo November' });
  assert.equal((await finance({ action: 'voidStatement', statementId: oct.id, version: issued.version, reason: 'Redo October' })).status, 'void');
});

test('M3: a legacy issued October a later statement relies on is not voided first, and is never prepared again by nights', async () => {
  await as(ACCOUNTS);
  const nov = await finance({ action: 'prepareStatement', propertyId: ISS, period: '2025-11' });
  assert.deepEqual(nov.detail.alreadyCounted, [ISS_STAY]);
  await finance({ action: 'issueStatement', statementId: nov.id, version: nov.version });
  await as(ADMIN);
  await assert.rejects(finance({ action: 'voidStatement', statementId: issOct.id, version: await statementVersion(issOct.id), reason: 'Redo October' }), /Void the later statement first/);
  // A void made before this fix (straight in the database). Preparing October again from the screen (a new
  // statement, by nights) would count 4 of 6 nights: refused. By check-in it counts the whole stay again.
  await one("update private.workspace_owner_statements set status='void',void_reason='Voided before the fix' where id=$1 returning id", [issOct.id]);
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: ISS, period: '2025-10', method: 'nights' }), /Void the later statement first/);
  const oct = await finance({ action: 'prepareStatement', propertyId: ISS, period: '2025-10', method: 'check_in_month' });
  assert.deepEqual([entry(oct, ISS_STAY).counted, entry(oct, ISS_STAY).grossMinor, entry(oct, ISS_STAY).wholeStay], [true, 60000, true]);
});

test('M1 and X3: a stay paid differently after its first period was issued never blocks the next one', async () => {
  const P = await property('Deadlock flat');
  const BK = await stay(P, 'Booking spanning', 'booking_com', '5550000777', '2025-11-26', '2025-12-03', 60192);
  const DEC = await stay(P, 'December direct', 'direct', null, '2025-12-10', '2025-12-12', 20000);
  await as(ADMIN);
  await terms(P, { vatOnFee: true });
  await as(ACCOUNTS);
  // Approved at the expected amount before the funds arrived, then November is issued and paid.
  assert.equal((await finance({ action: 'agreePayouts', note: 'Month end approval', items: [{ reservationId: BK, version: await version(BK) }] })).approved, 1);
  const nov = await finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' });
  assert.equal(entry(nov, BK).grossMinor, 42994, 'five of seven nights of 60192');
  const issued = await finance({ action: 'issueStatement', statementId: nov.id, version: nov.version });
  await finance({ action: 'recordOwnerPayout', statementId: nov.id, version: issued.version, method: 'bank_transfer', reference: 'BACS-NOV' });
  // Booking.com pays after check-out, 192p less than expected.
  await finance({ action: 'importPayoutReport', channel: 'booking_com', fileName: 'booking-dec.csv', lines: [line('5550000777', 60000, 'K1', { grossMinor: 72000, paidOn: '2025-12-05' })] });
  const row = await payoutRow(BK);
  assert.deepEqual([row.state, row.receivedMinor], ['different', 60000], 'the reconciliation screen still shows the difference');
  // December takes the rest of the stored copy, flags the change, and lists the late money.
  const preview = await report('statementPreview', { propertyId: P, from: '2025-12-01', to: '2026-01-01' });
  assert.equal(preview.blocked, false);
  assert.deepEqual(preview.blockedReasons, []);
  assert.equal(preview.stays.find(x => x.reservationId === BK).grossMinor, 17198);
  assert.ok(preview.flags.includes(`stay_changed_after_statement:${BK}`));
  assert.deepEqual([preview.lateMoneyAfterStatement, preview.lateMoneyAfterStatementCount], [[BK], 1]);
  const dec = await finance({ action: 'prepareStatement', propertyId: P, period: '2025-12' });
  assert.equal(dec.grossMinor, 17198 + 20000);
  assert.equal(entry(dec, DEC).grossMinor, 20000);
  assert.equal(entry(nov, BK).grossMinor + entry(dec, BK).grossMinor, 60192, 'the shares add up to the stored copy');
  assert.ok(dec.detail.internal.includes(`stay_changed_after_statement:${BK}`));
  // The copy November stored (the whole stay as it was when issued), carried on unchanged by December.
  const copy = e => [e.stayGrossMinor, e.stayOtaFeeMinor, e.staySettledMinor, e.stayNights, e.stayCheckIn, e.stayCheckOut];
  assert.deepEqual(copy(entry(nov, BK)), [60192, 0, 60192, 7, '2025-11-26', '2025-12-03']);
  assert.deepEqual(copy(entry(dec, BK)), copy(entry(nov, BK)));
  assert.deepEqual([entry(nov, BK).wholeStay, entry(dec, BK).wholeStay], [false, false]);
});

test('M2: a stay extended after its first period was issued is not shared out again at its new length', async () => {
  const P = await property('Moved stay flat');
  const S = await stay(P, 'Direct spanning', 'direct', null, '2025-11-26', '2025-12-03', 70000);
  await as(ADMIN);
  await terms(P);
  await as(ACCOUNTS);
  const nov = await finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' });
  await finance({ action: 'issueStatement', statementId: nov.id, version: nov.version });
  assert.equal(entry(nov, S).grossMinor, 50000);
  await as(ADMIN);
  await rpc('workspace_controls_action', [{ action: 'updateReservation', requestId: crypto.randomUUID(), propertyId: P, reservationId: S, version: await version(S), checkIn: '2025-11-26', checkOut: '2025-12-10', status: 'confirmed' }]);
  const dec = await compute(P, '2025-12-01', '2026-01-01');
  const share = dec.stays.find(x => x.reservationId === S);
  assert.deepEqual([share.grossMinor, share.nightsInPeriod, share.counted], [20000, 9, true], 'the money from the copy, the nights as booked now');
  assert.equal(entry(nov, S).grossMinor + share.grossMinor, 70000);
  assert.deepEqual(dec.flags, [`stay_changed_after_statement:${S}`]);
  // statementFor gives the same figures from the same stored copy.
  const t = dec.terms;
  const ts = statementFor({ from: '2025-12-01', to: '2026-01-01', method: 'nights', cleans: [], payables: [],
    terms: { managementFeeBps: t.managementFeeBps, vatOnFee: t.vatOnFee, cleaningCostMinor: t.cleaningCostMinor, cleanChargeMode: t.cleanChargeMode },
    stays: [{ id: S, channel: 'direct', checkIn: '2025-11-26', checkOut: '2025-12-10', status: 'confirmed', settledMinor: 70000,
      storedShare: { grossMinor: 70000, otaFeeMinor: 0, settledMinor: 70000, nights: 7, checkIn: '2025-11-26', checkOut: '2025-12-03' } }] });
  assert.deepEqual([ts.grossMinor, ts.feeMinor, ts.payoutMinor, ts.nightsBooked, ts.flags, ts.blockedReasons], [dec.grossMinor, dec.feeMinor, dec.payoutMinor, dec.nightsBooked, dec.flags, dec.blockedReasons]);
});

test('M7: a stay is never split by nights on one statement and by check-in on another', async () => {
  await as(ADMIN);
  // December by nights first; November by check-in would count none of the stay.
  const A = await property('Nights then check-in flat');
  const X = await stay(A, 'Across the month end', 'direct', null, '2025-11-28', '2025-12-03', 50000);
  await as(ADMIN); await terms(A);
  await as(ACCOUNTS);
  const decA = await finance({ action: 'prepareStatement', propertyId: A, period: '2025-12' });
  assert.equal(decA.grossMinor, 20000);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: A, period: '2025-11', method: 'check_in_month' }), /counted the other way/);
  assert.deepEqual((await compute(A, '2025-11-01', '2025-12-01', 'check_in_month')).blockedReasons, [`stay_method_conflict:${X}`]);
  await finance({ action: 'voidStatement', statementId: decA.id, version: decA.version, reason: 'Prepared the wrong way' });
  assert.equal((await finance({ action: 'prepareStatement', propertyId: A, period: '2025-11', method: 'check_in_month' })).grossMinor, 50000);
  // December by check-in first; November by nights would count three nights and leave December's two unpaid.
  await as(ADMIN);
  const B = await property('Check-in then nights flat');
  const Y = await stay(B, 'Across the month end', 'direct', null, '2025-11-28', '2025-12-03', 50000);
  await as(ADMIN); await terms(B);
  await as(ACCOUNTS);
  const decB = await finance({ action: 'prepareStatement', propertyId: B, period: '2025-12', method: 'check_in_month' });
  assert.deepEqual([decB.grossMinor, entry(decB, Y).counted], [0, false]);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: B, period: '2025-11', method: 'nights' }), /counted the other way/);
  assert.deepEqual((await compute(B, '2025-11-01', '2025-12-01')).blockedReasons, [`stay_method_conflict:${Y}`]);
  assert.equal((await finance({ action: 'prepareStatement', propertyId: B, period: '2025-11', method: 'check_in_month' })).grossMinor, 50000);
});

test('M6: bulk approval leaves a payout with repeated line amounts to be checked one by one', async () => {
  const P = await property('Duplicate lines flat');
  const S = await stay(P, 'Airbnb dup', 'airbnb', 'HMDUP00001', '2025-11-10', '2025-11-12', 30000);
  await as(ADMIN);
  await terms(P);
  await as(ACCOUNTS);
  await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'a.csv', lines: [line('HMDUP00001', 30000, null, { paidOn: null }), line('HMOTHER001', 100, null, { paidOn: null })] });
  await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'b.csv', lines: [line('HMDUP00001', 30000, null, { paidOn: null }), line('HMOTHER002', 100, null, { paidOn: null })] });
  const row = await payoutRow(S);
  assert.deepEqual([row.state, row.receivedMinor, row.repeatedAmount], ['different', 60000, 30000]);
  const bulk = await finance({ action: 'agreePayouts', note: 'Approve the month', includeDifferent: true, items: [{ reservationId: S, version: await version(S) }] });
  assert.deepEqual([bulk.approved, bulk.approvedMinor, bulk.skipped.different, bulk.repeatedAmountSkipped], [0, 0, 1, 1]);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' }), /Reconcile every stay/);
  // One by one, at the amount really received.
  await finance({ action: 'agreePayout', reservationId: S, version: await version(S), agreedMinor: 30000, note: 'The second upload repeated the first' });
  assert.equal((await finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' })).revenueMinor, 30000);
});

test('M4: an issued period starting on the 1st locks only its own days', async () => {
  const P = await property('Partial month flat');
  const EARLY = await stay(P, 'Early Nov', 'direct', null, '2025-11-02', '2025-11-04', 20000);
  const LATE = await stay(P, 'Late Nov airbnb', 'airbnb', 'HMLATE0001', '2025-11-20', '2025-11-22', 30000);
  await as(ADMIN);
  await terms(P);
  await as(ACCOUNTS);
  const first = await finance({ action: 'prepareStatement', propertyId: P, from: '2025-11-01', to: '2025-11-10' });
  await finance({ action: 'issueStatement', statementId: first.id, version: first.version });
  await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'late.csv', lines: [line('HMLATE0001', 29500, 'L1')] });
  const locked = async id => (await one('select private.workspace_payout_stay_locked(r) l from private.workspace_reservations r where id=$1', [id])).l;
  assert.deepEqual([await locked(EARLY), await locked(LATE)], [true, false]);
  const dayLocked = async day => (await one('select private.workspace_statement_day_locked($1,$2) l', [P, day])).l;
  assert.deepEqual([await dayLocked('2025-11-05'), await dayLocked('2025-11-09'), await dayLocked('2025-11-10'), await dayLocked('2025-11-20')], [true, true, false, false], 'cleans: only the issued days');
  await finance({ action: 'agreePayout', reservationId: LATE, version: await version(LATE), agreedMinor: 29500, note: 'Paid less, accepted' });
  const rest = await finance({ action: 'prepareStatement', propertyId: P, from: '2025-11-10', to: '2025-12-01' });
  assert.equal(rest.revenueMinor, 29500);
});

test('X1: issuing refuses a draft whose figures have changed since it was prepared', async () => {
  const P = await property('Issue check flat');
  const S = await stay(P, 'Direct November', 'direct', null, '2025-11-03', '2025-11-05', 30000);
  await as(ADMIN);
  await terms(P);
  await as(ACCOUNTS);
  let draft = await finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' });
  // An approved repair lands in the month after the draft was prepared.
  await one(`insert into private.workspace_expenses(property_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
    values($1,'Plumber','R-1','maintenance','Boiler repair',5000,'2025-11-10','manual','approved',$2,gen_random_uuid()) returning id`, [P, users[ADMIN]]);
  await assert.rejects(finance({ action: 'issueStatement', statementId: draft.id, version: draft.version }), /Figures changed, prepare the statement again/);
  draft = await finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' });
  assert.equal(draft.expensesMinor, 5000);
  // The stay's amount changes: the totals and the stored copy no longer match.
  await one('update private.workspace_reservations set payout_minor=31000 where id=$1 returning id', [S]);
  await assert.rejects(finance({ action: 'issueStatement', statementId: draft.id, version: draft.version }), /Figures changed/);
  draft = await finance({ action: 'prepareStatement', propertyId: P, period: '2025-11' });
  assert.equal((await finance({ action: 'issueStatement', statementId: draft.id, version: draft.version })).status, 'issued');
});

test('X2: an invoice moved to another property must have a client of that property', async () => {
  const HOME = await property('Invoice home'), FAR = await property('Invoice far');
  await one("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$4),($3,$5,'client',$4) returning property_id", [HOME, users[OWNER], FAR, users[ADMIN], users[OTHER_OWNER]]);
  await as(ACCOUNTS);
  const invoice = await teams({ action: 'saveHubItem', kind: 'invoice', title: 'Linen for the flat', propertyId: HOME, clientId: users[OWNER], amountMinor: 20000 });
  assert.equal(invoice.clientId, users[OWNER]);
  await assert.rejects(teams({ action: 'saveHubItem', kind: 'invoice', id: invoice.id, version: invoice.version, title: 'Linen for the flat', propertyId: FAR }), /not linked to this property/);
  const moved = await teams({ action: 'saveHubItem', kind: 'invoice', id: invoice.id, version: invoice.version, title: 'Linen for the flat', propertyId: FAR, clientId: users[OTHER_OWNER] });
  assert.deepEqual([moved.propertyId, moved.clientId], [FAR, users[OTHER_OWNER]]);
});

test('S1: the owner sees statements of any dates once, never an estimate under them, and VAT in estimates', async () => {
  const H = await property('Harbour flat'), V = await property('VAT flat');
  await one("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$3,'client',$4),($2,$3,'client',$4) returning property_id", [H, V, users[OWNER], users[ADMIN]]);
  await sql('insert into private.workspace_property_financials(property_id,management_fee_bps,cleaning_cost_minor,vat_on_fee) values($1,2000,5000,false),($2,2000,5000,true)', [H, V]);
  await stay(H, 'August stay', 'direct', null, '2026-08-10', '2026-08-13', 30000);
  await stay(H, 'Early September stay', 'direct', null, '2026-09-03', '2026-09-05', 20000);
  await stay(V, 'October stay', 'direct', null, '2026-10-02', '2026-10-05', 30000);
  const issue = (start, end, payout) => sql(`insert into private.workspace_owner_statements(property_id,period_start,period_end,method,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
    values($1,$2,$3,'nights','issued',1,0,0,0,2000,0,$4,$5::jsonb,$6,now())`, [H, start, end, payout, JSON.stringify({ stays: [], expenses: [], internal: ['secret_flag'], cleanCosts: [{ note: 'secret review note' }] }), users[ADMIN]]);
  await issue('2026-07-01', '2026-09-01', 77777); // two months
  await issue('2026-09-15', '2026-10-15', 99999); // the middle of September to the middle of October
  await as(OWNER);
  const raw = await rpc('workspace_owner_periods', ['2026-07-01', '2026-10-01']);
  for (const secret of ['secret', 'internal', 'cleanCosts', 'Person ']) assert.ok(!JSON.stringify(raw).includes(secret), `nothing staff-only: ${secret}`);
  const periods = ownerPeriodsSchema.parse(raw);
  const cell = (prop, month) => periods.months.find(c => c.propertyId === prop && c.month === month);
  const view = c => [c.source, c.status, c.covered, c.revenueMinor, c.payoutMinor, c.uncoveredNights];
  assert.deepEqual(view(cell(H, '2026-07')), ['statement', 'issued', true, 1, 77777, 0]);
  assert.deepEqual(view(cell(H, '2026-08')), ['statement', 'issued', true, 0, 0, 0], 'August is on July\'s statement: no estimate, no second payout');
  assert.deepEqual(view(cell(H, '2026-09')), ['statement', 'issued', true, 1, 99999, 14]);
  assert.deepEqual(view(cell(H, '2026-10')), ['statement', 'issued', true, 0, 0, 17]);
  assert.deepEqual(cell(H, '2026-08').coveringStatements, [{ periodStart: '2026-07-01', periodLastDay: '2026-08-31', status: 'issued', payoutMinor: null }]);
  assert.deepEqual(cell(H, '2026-07').coveringStatements, [{ periodStart: '2026-07-01', periodLastDay: '2026-08-31', status: 'issued', payoutMinor: 77777 }]);
  assert.equal(summarisePeriod(periods.months, ['2026-07', '2026-08'], 1, H).payoutMinor, 77777, 'counted once across the months');
  assert.equal(summarisePeriod(periods.months, ['2026-07', '2026-08', '2026-09', '2026-10'], 1, H).basis, 'issued');
  assert.deepEqual(coverNotes(periods.months, ['2026-08'], H), ['August is on the statement for 1 Jul to 31 Aug, shown in July.']);
  assert.deepEqual(coverNotes(periods.months, ['2026-09'], H), ['Part of September is not on a statement yet.']);
  assert.equal(coverNotes(periods.months, ['2026-10'], H).length, 2);
  // Owner expenses: any month an issued statement covers is locked.
  assert.equal(cell(H, '2026-08').ownerExpensesLocked, true);
  // The estimate for a property charged VAT on the fee: 20% of 30000 is 6000, VAT 1200 on it.
  const vat = cell(V, '2026-10');
  assert.deepEqual([vat.source, vat.feeMinor, vat.vatMinor, vat.payoutMinor], ['estimate', 6000, 1200, 30000 - 6000 - 1200]);
  const october = summarisePeriod(periods.months, ['2026-10'], 1, V);
  assert.equal(october.bookingIncomeMinor - october.cleaningMinor - october.expensesMinor - october.feeMinor - october.vatMinor, october.payoutMinor, 'the lines add up to the payout');
});

test('S4: owner expenses are read only by finance staff with the owner statements tool', async () => {
  const P = await property('Expenses flat');
  await one("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3) returning property_id", [P, users[OWNER], users[ADMIN]]);
  await as(OWNER);
  await rpc('workspace_owner_save_expense', [{ action: 'saveOwnerExpense', requestId: crypto.randomUUID(), propertyId: P, month: '2026-06', amountMinor: 1500, category: 'utilities', note: 'Water bill' }]);
  await as(BARE_ACCOUNTS);
  await assert.rejects(rpc('workspace_owner_expenses_read', [null, null, null]), /Finance access required/);
  await as(ACCOUNTS);
  const rows = await rpc('workspace_owner_expenses_read', [P, null, null]);
  assert.deepEqual(rows.map(r => [r.amountMinor, r.note]), [[1500, 'Water bill']]);
});
