import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Owner statements version 2 (20261012100000): any period, stays shared by nights, OTA fees, changeovers,
// the management fee, VAT and other payables on ordered lines, the blocks while stays are unsettled or
// dear cleans unreviewed, overlap refusal, no double counting against old-style monthly statements, and the
// owner's view without internal details. The SQL must give exactly the figures of statementFor in
// lib/statement-maths.ts: the brief's worked example and 200 seeded random scenarios are checked against it.
//
// The worked example is the brief's November, set in November 2025 so the period has started (a statement
// cannot be prepared for a period still to come); November and December have the same lengths in 2025.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { statementFor, prorate, VAT_BPS } = await vite.ssrLoadModule('/lib/statement-maths.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'accounts', 'client', 'cleans', 'cleans', 'cleans', 'client'];
const users = roles.map((_, i) => `d1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [, ADMIN, ACCOUNTS, OWNER, CLEANER_A, CLEANER_B, CLEANER_C, OTHER_OWNER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `statementsv2${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('d100', 'd200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('d100', 'd200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('d100', 'd200') })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const payables = input => rpc('workspace_payables_action', [{ requestId: crypto.randomUUID(), ...input }]);
const report = (section, { propertyId = null, id = null, from = null, to = null, filters = null } = {}) => rpc('workspace_finance_report', [section, propertyId, id, from, to, filters]);
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const terms = (propertyId, over = {}) => finance({ action: 'setStatementTerms', propertyId, managementFeeBps: 1500, cleaningCostMinor: 6000, vatOnFee: true, cleanChargeMode: 'agreed_fee', ...over });

async function property(name) {
  return (await sql('insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id', [name, users[ADMIN]]))[0].id;
}
async function stay(prop, reference, channel, code, checkIn, checkOut, payout, status = 'confirmed') {
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,$5,'manual',$6,$7,$8) returning id`, [prop, reference, checkIn, checkOut, status, channel, code, payout]))[0].id;
}
async function clean(prop, dueOn, assignee, { status = 'completed', phase = 'accepted' } = {}) {
  const [w] = await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,due_on,assignee_id,created_by) values(gen_random_uuid(),$1,'cleaning-schedule','Clean',$2,$3,$4,$5) returning id", [prop, status, dueOn, assignee, users[ADMIN]]);
  await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'cleaning',$2::jsonb)", [w.id, JSON.stringify({ phase })]);
  return w.id;
}
async function expense(prop, receivedOn, description, amountMinor, status = 'approved') {
  return (await sql(`insert into private.workspace_expenses(property_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
    values($1,'Supplier '||left(md5(random()::text),8),left(md5(random()::text),12),'maintenance',$2,$3,$4,'manual',$5,$6,gen_random_uuid()) returning id`, [prop, description, amountMinor, receivedOn, status, users[ADMIN]]))[0].id;
}
const line = (channel, reference, amountMinor, { gross = null, commission = null, hostFee = null, paymentFee = null, paidOn = '2025-11-30' } = {}) => ({
  reference, amountMinor, grossMinor: gross, commissionMinor: commission, hostFeeMinor: hostFee, paymentFeeMinor: paymentFee, cleaningFeeMinor: null,
  paidOn, lineType: 'Reservation', key: [channel, reference.toUpperCase(), paidOn, 'Reservation', amountMinor, 'PO-1', 1].join('|'),
});
const lineView = lines => lines.map(l => [l.kind, l.refId, l.amountMinor]);
// The figures statementFor and the SQL share, in one shape.
const figures = r => ({ grossMinor: r.grossMinor, otaFeesMinor: r.otaFeesMinor, changeoversMinor: r.changeoversMinor, feeBaseMinor: r.feeBaseMinor, feeMinor: r.feeMinor,
  vatMinor: r.vatMinor, payablesMinor: r.payablesMinor, payoutMinor: r.payoutMinor, nightsBooked: r.nightsBooked, nightsAvailable: r.nightsAvailable,
  flags: r.flags, blocked: r.blocked, blockedReasons: r.blockedReasons,
  lines: r.lines.map(l => ({ kind: l.kind, date: l.date, label: l.label, amountMinor: l.amountMinor, refId: l.refId })),
  stays: r.stays.map(s => ({ id: s.id ?? s.reservationId, nights: s.nights, nightsInPeriod: s.nightsInPeriod, grossMinor: s.grossMinor, otaFeeMinor: s.otaFeeMinor, payoutMinor: s.payoutMinor })) });
const compute = async (prop, from, to, method = 'nights') => (await sql('select private.workspace_statement_compute($1,$2,$3,$4,null) c', [prop, from, to, method]))[0].c;

await sql('insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values($1,5500,$3),($2,5800,$3)', [users[CLEANER_A], users[CLEANER_B], users[ADMIN]]);

// ---- The worked example ---------------------------------------------------------------------------------
const EX = await property('Worked example flat');
await sql("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)", [EX, users[OWNER], users[ADMIN]]);
const AIR = await stay(EX, 'Airbnb stay', 'airbnb', 'HMNOV0001', '2025-11-03', '2025-11-08', 50000);
const VRBO = await stay(EX, 'Vrbo stay', 'vrbo', 'HA-NOV0001', '2025-11-12', '2025-11-15', 39008);
const DIRECT = await stay(EX, 'Direct stay', 'direct', null, '2025-11-20', '2025-11-22', 30000);
const BOOK = await stay(EX, 'Booking.com stay', 'booking_com', '5550000001', '2025-11-26', '2025-12-03', 60192);
const C1 = await clean(EX, '2025-11-08', users[CLEANER_A]);
const C2 = await clean(EX, '2025-11-15', users[CLEANER_B]);
const C3 = await clean(EX, '2025-11-22', users[CLEANER_A]);
const C4 = await clean(EX, '2025-12-03', users[CLEANER_A]);
const P1 = await expense(EX, '2025-11-10', 'Boiler service', 6000);
const P2 = await expense(EX, '2025-11-25', 'Light bulbs', 2500);
await expense(EX, '2025-11-12', 'Quote not approved yet', 99000, 'to_approve');
await as(ADMIN);
await terms(EX);
await as(ACCOUNTS);
await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-nov.csv', lines: [line('airbnb', 'HMNOV0001', 50000, { hostFee: 1546 })] });
await finance({ action: 'importPayoutReport', channel: 'vrbo', fileName: 'vrbo-nov.csv', lines: [line('vrbo', 'HA-NOV0001', 39008, { gross: 42400, commission: 3392 })] });
await finance({ action: 'importPayoutReport', channel: 'booking_com', fileName: 'booking-nov.csv', lines: [line('booking_com', '5550000001', 60192, { gross: 72000 })] });
// The 15 Nov clean cost 7500 on the cleaner's invoice; the others cost the cleaners' rates.
await payables({ action: 'recordCleanerInvoice', supplier: 'Person 5', cleanerId: users[CLEANER_B], reference: 'NOV-15', invoiceDate: '2025-11-30', totalMinor: 7500, lines: [{ workId: C2, amountMinor: 7500 }] });

// The same facts, as statementFor takes them.
const exampleInput = (over = {}) => ({
  from: '2025-11-01', to: '2025-12-01', method: 'nights',
  terms: { managementFeeBps: 1500, vatOnFee: true, cleaningCostMinor: 6000, cleanChargeMode: 'agreed_fee' },
  stays: [
    { id: AIR, channel: 'airbnb', checkIn: '2025-11-03', checkOut: '2025-11-08', status: 'confirmed', settledMinor: 50000, itemisedFeesMinor: 1546 },
    { id: VRBO, channel: 'vrbo', checkIn: '2025-11-12', checkOut: '2025-11-15', status: 'confirmed', settledMinor: 39008, itemisedFeesMinor: 3392 },
    { id: DIRECT, channel: 'direct', checkIn: '2025-11-20', checkOut: '2025-11-22', status: 'confirmed', settledMinor: 30000 },
    { id: BOOK, channel: 'booking_com', checkIn: '2025-11-26', checkOut: '2025-12-03', status: 'confirmed', settledMinor: 60192, itemisedFeesMinor: 72000 - 60192 },
  ],
  cleans: [
    { id: C1, date: '2025-11-08', actualCostMinor: 5500, decision: null, reviewed: false },
    { id: C2, date: '2025-11-15', actualCostMinor: 7500, decision: 'agreed_fee', reviewed: true },
    { id: C3, date: '2025-11-22', actualCostMinor: 5500, decision: null, reviewed: false },
    { id: C4, date: '2025-12-03', actualCostMinor: 5500, decision: null, reviewed: false },
  ],
  payables: [{ id: P1, date: '2025-11-10', description: 'Boiler service', amountMinor: 6000 }, { id: P2, date: '2025-11-25', description: 'Light bulbs', amountMinor: 2500 }],
  ...over,
});
const preparedNov = { id: null };

test('worked example: November waits for the dear clean to be reviewed, then matches the brief to the penny', async () => {
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, period: '2025-11' }), /Review the cleans that cost more than agreed first/);
  const preview = await report('statementPreview', { propertyId: EX, from: '2025-11-01', to: '2025-12-01' });
  assert.deepEqual([preview.blocked, preview.blockedReasons, preview.flags], [true, [`clean_unreviewed:${C2}`], [`clean_over_agreed:${C2}`]]);
  await payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'Deep clean after a party; agreed fee only' });

  const s = await finance({ action: 'prepareStatement', propertyId: EX, period: '2025-11' });
  preparedNov.id = s.id;
  assert.deepEqual([s.periodStart, s.periodEnd, s.periodLastDay, s.period, s.method, s.status], ['2025-11-01', '2025-12-01', '2025-11-30', '2025-11', 'nights', 'draft']);
  assert.equal(s.grossMinor, 175374);
  assert.equal(s.otaFeesMinor, 13372);
  assert.equal(s.cleaningMinor, 18000); assert.equal(s.cleaningCount, 3);
  assert.equal(s.feeBps, 1500); assert.equal(s.feeMinor, 24300);
  assert.equal(s.vatRateBps, 2000); assert.equal(s.vatMinor, 4860);
  assert.equal(s.expensesMinor, 8500);
  assert.equal(s.payoutMinor, 106342);
  assert.equal(s.revenueMinor, 175374 - 13372, 'booking income after OTA fees, as before');
  assert.deepEqual([s.nightsBooked, s.nightsAvailable, s.occupancyBps], [15, 30, 5000]);
  assert.equal(s.cleanChargeMode, 'agreed_fee');
  assert.deepEqual(lineView(s.detail.lines), [
    ['ota_fee', AIR, 1546], ['ota_fee', VRBO, 3392], ['ota_fee', BOOK, 8434],
    ['changeover', C1, 6000], ['changeover', C2, 6000], ['changeover', C3, 6000],
    ['management_fee', null, 24300], ['vat', null, 4860],
    ['payable', P1, 6000], ['payable', P2, 2500],
  ]);
  assert.deepEqual(s.detail.lines.map(l => l.label), ['Airbnb fees', 'Vrbo fees', 'Booking.com fees', 'Changeover clean', 'Changeover clean', 'Changeover clean',
    'Management fee (15%)', 'VAT on the management fee (20%)', 'Boiler service', 'Light bulbs']);
  assert.equal(s.grossMinor - s.detail.lines.reduce((n, l) => n + l.amountMinor, 0), s.payoutMinor);
  const booking = s.detail.stays.find(x => x.reservationId === BOOK);
  assert.deepEqual([booking.grossMinor, booking.otaFeeMinor, booking.amountMinor, booking.nightsInPeriod, booking.nights], [51428, 8434, 42994, 5, 7]);
  // The old statement shape is still there for the screens that read it.
  assert.deepEqual(s.detail.expenses.map(e => [e.expenseId, e.amountMinor]), [[P1, 6000], [P2, 2500]]);
  assert.equal(s.detail.cleaningCostMinor, 6000);
  // Staff see the internal details: the clean's real cost, the review and the flag.
  assert.deepEqual(s.detail.internal, [`clean_over_agreed:${C2}`]);
  const c2 = s.detail.cleanCosts.find(c => c.workId === C2);
  assert.deepEqual([c2.actualMinor, c2.costSource, c2.reviewed, c2.state, c2.decision, c2.note, c2.chargedMinor], [7500, 'invoice', true, 'reviewed', 'agreed_fee', 'Deep clean after a party; agreed fee only', 6000]);

  // Exactly what statementFor says for the same facts.
  const ts = statementFor(exampleInput());
  assert.deepEqual(figures({ ...preview, ...(await compute(EX, '2025-11-01', '2025-12-01')) }), figures(ts));
});

test('worked example: December takes the rest of the Booking.com stay, and the two months add up exactly', async () => {
  await as(ACCOUNTS);
  const dec = await finance({ action: 'prepareStatement', propertyId: EX, from: '2025-12-01', to: '2026-01-01' });
  assert.deepEqual([dec.periodStart, dec.periodEnd, dec.nightsAvailable, dec.nightsBooked], ['2025-12-01', '2026-01-01', 31, 2]);
  const booking = dec.detail.stays.find(x => x.reservationId === BOOK);
  assert.deepEqual([booking.grossMinor, booking.otaFeeMinor, booking.amountMinor], [20572, 3374, 17198]);
  assert.deepEqual([dec.grossMinor, dec.otaFeesMinor], [20572, 3374]);
  const nov = (await sql('select detail from private.workspace_owner_statements where id=$1', [preparedNov.id]))[0].detail.stays.find(x => x.reservationId === BOOK);
  assert.equal(nov.grossMinor + booking.grossMinor, 72000);
  assert.equal(nov.otaFeeMinor + booking.otaFeeMinor, 11808);
  assert.equal(nov.amountMinor + booking.amountMinor, 60192);
  assert.deepEqual(lineView(dec.detail.lines), [['ota_fee', BOOK, 3374], ['changeover', C4, 6000], ['management_fee', null, 2580], ['vat', null, 516]]);
  assert.deepEqual(figures(await compute(EX, '2025-12-01', '2026-01-01')), figures(statementFor(exampleInput({ from: '2025-12-01', to: '2026-01-01', payables: [] }))));
});

test('preparing the same period again keeps one statement; an overlapping period is refused', async () => {
  await as(ACCOUNTS);
  const again = await finance({ action: 'prepareStatement', propertyId: EX, from: '2025-11-01', to: '2025-12-01' });
  assert.equal(again.id, preparedNov.id, 'the month and the same dates are one statement');
  assert.equal(again.version, 2);
  assert.equal(again.payoutMinor, 106342);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2025-11-15', to: '2025-12-15' }), /already covers part of these dates/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2025-10-20', to: '2025-11-02' }), /already covers part of these dates/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2025-11-05', to: '2025-11-05' }), /must end after it starts/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2025-02-30', to: '2025-03-05' }), /Choose the statement dates/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2024-01-01', to: '2025-06-01' }), /up to a year/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, period: '2025-11', from: '2025-11-01', to: '2025-12-01' }), /not both/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2025-11-01' }), /Choose a month or dates/);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, period: '2025-11', method: 'checkout' }), /how stays are counted/);
  const later = (await sql("select (current_date+1)::text d,(current_date+10)::text e"))[0];
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: later.d, to: later.e }), /period that has started/);
});

test('actual-cost mode, 15% against 12%, and VAT off', async () => {
  const prepare = async () => { await as(ACCOUNTS); return finance({ action: 'prepareStatement', propertyId: EX, period: '2025-11' }); };
  const tsNov = over => statementFor(exampleInput(over));
  // Actual cost on the property; the review chose the agreed fee for the dear clean, so only the cheaper two move.
  await as(ADMIN); await terms(EX, { cleanChargeMode: 'actual_cost' });
  let s = await prepare();
  assert.equal(s.cleaningMinor, 5500 + 6000 + 5500);
  assert.equal(s.payoutMinor, tsNov({ terms: { ...exampleInput().terms, cleanChargeMode: 'actual_cost' } }).payoutMinor);
  // The review now says actual cost too: 18500 in changeovers.
  await as(ACCOUNTS);
  await payables({ action: 'reviewCleanCost', workId: C2, decision: 'actual_cost', note: 'Owner agreed to pay the deep clean' });
  s = await prepare();
  assert.equal(s.cleaningMinor, 18500);
  assert.equal(s.payoutMinor, 106342 - 500);
  assert.equal(s.cleanChargeMode, 'actual_cost');
  assert.deepEqual(figures(await compute(EX, '2025-11-01', '2025-12-01')),
    figures(tsNov({ terms: { ...exampleInput().terms, cleanChargeMode: 'actual_cost' }, cleans: exampleInput().cleans.map(c => c.id === C2 ? { ...c, decision: 'actual_cost' } : c) })));
  await as(ADMIN); await terms(EX);
  await as(ACCOUNTS);
  await payables({ action: 'reviewCleanCost', workId: C2, decision: 'agreed_fee', note: 'Deep clean after a party; agreed fee only' });

  // 12% instead of 15%: 162002 x 12% = 19440.24, so 19440, and VAT 3888.
  await as(ADMIN); await terms(EX, { managementFeeBps: 1200 });
  s = await prepare();
  assert.deepEqual([s.feeBps, s.feeMinor, s.vatMinor, s.payoutMinor], [1200, 19440, 3888, 175374 - 13372 - 18000 - 19440 - 3888 - 8500]);
  assert.equal(s.detail.lines.find(l => l.kind === 'management_fee').label, 'Management fee (12%)');
  assert.equal(s.payoutMinor, tsNov({ terms: { ...exampleInput().terms, managementFeeBps: 1200 } }).payoutMinor);
  // VAT off: no VAT line, the payout is VAT higher.
  await as(ADMIN); await terms(EX, { vatOnFee: false });
  s = await prepare();
  assert.deepEqual([s.feeMinor, s.vatMinor, s.vatRateBps, s.payoutMinor], [24300, 0, 0, 106342 + 4860]);
  assert.equal(s.detail.lines.some(l => l.kind === 'vat'), false);
  await as(ADMIN); await terms(EX);
  s = await prepare();
  assert.equal(s.payoutMinor, 106342);
});

test('a stay or payout under an issued statement is locked for any period it overlaps', async () => {
  // December is issued while November is still a draft: the Booking.com stay checks in in November but
  // has nights in December, so it is locked.
  await as(ACCOUNTS);
  const dec = (await sql("select id,version from private.workspace_owner_statements where property_id=$1 and period_start='2025-12-01'", [EX]))[0];
  await as(ACCOUNTS);
  await finance({ action: 'issueStatement', statementId: dec.id, version: dec.version });
  const r = (await sql('select version from private.workspace_reservations where id=$1', [BOOK]))[0];
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'setReservationFinancials', propertyId: EX, reservationId: BOOK, version: r.version, channel: 'booking_com', channelReference: '5550000001', guests: 2, payoutMinor: 60192 }), /Void the issued statement/);
  await assert.rejects(finance({ action: 'agreePayout', reservationId: BOOK, version: r.version, agreedMinor: 60000, note: 'Late change attempt' }), /Void the issued statement/);
  const bulk = await finance({ action: 'agreePayouts', note: 'Approve the month', includeDifferent: true, items: [{ reservationId: BOOK, version: r.version }] });
  assert.equal(bulk.skipped.locked, 1);
  // A stay only in November is not locked by December.
  const d = (await sql('select version from private.workspace_reservations where id=$1', [DIRECT]))[0];
  await as(ACCOUNTS);
  await finance({ action: 'setReservationFinancials', propertyId: EX, reservationId: DIRECT, version: d.version, channel: 'direct', guests: 2, payoutMinor: 30000 });
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: EX, from: '2025-12-01', to: '2026-01-01' }), /has been issued/);
});

test('owners read the issued statement without the internal details', async () => {
  await as(ACCOUNTS);
  const nov = (await sql('select id,version from private.workspace_owner_statements where id=$1', [preparedNov.id]))[0];
  await as(ACCOUNTS);
  await finance({ action: 'issueStatement', statementId: nov.id, version: nov.version });
  await as(OWNER);
  const mine = await rpc('workspace_finance_read', ['statements', null, null, null, null]);
  const s = mine.find(x => x.id === nov.id);
  assert.ok(s, 'the owner sees their issued statement');
  for (const key of ['internal', 'cleanCosts', 'alreadyCounted']) assert.equal(s.detail[key], undefined, `no ${key} for owners`);
  assert.deepEqual([s.payoutMinor, s.grossMinor, s.vatMinor, s.nightsBooked, s.nightsAvailable, s.occupancyBps], [106342, 175374, 4860, 15, 30, 5000]);
  assert.deepEqual(lineView(s.detail.lines).map(l => l[0]), ['ota_fee', 'ota_fee', 'ota_fee', 'changeover', 'changeover', 'changeover', 'management_fee', 'vat', 'payable', 'payable']);
  const text = JSON.stringify(mine);
  for (const secret of ['actualMinor', 'Deep clean after a party', 'clean_over_agreed', 'cleanCosts', 'costSource', 'chargedMinor', 'alreadyCounted']) assert.equal(text.includes(secret), false, `owners never see ${secret}`);
  await assert.rejects(report('statementPreview', { propertyId: EX, from: '2025-11-01', to: '2025-12-01' }), /Accounts access required/);
  await as(OTHER_OWNER);
  assert.equal((await rpc('workspace_finance_read', ['statements', null, null, null, null])).some(x => x.id === nov.id), false);
  // Accounts read the same statement with its internal details, and the month lists every overlapping statement.
  await as(ACCOUNTS);
  const list = await rpc('workspace_finance_read', ['statements', EX, '2025-11', null, null]);
  assert.equal(list[0].statement.id, nov.id);
  assert.deepEqual(list[0].statement.detail.internal, [`clean_over_agreed:${C2}`]);
  assert.equal(list[0].statement.detail.cleanCosts.length, 3);
  assert.deepEqual(list[0].periodStatements.map(x => x.periodStart), ['2025-11-01']);
  assert.deepEqual((await rpc('workspace_finance_read', ['statements', EX, '2025-12', null, null]))[0].periodStatements.map(x => x.periodStart), ['2025-12-01']);
});

test('a statement waits while a stay in the period is unsettled', async () => {
  await as(ADMIN);
  const U = await property('Unsettled cottage');
  await as(ADMIN); await terms(U);
  const WAIT = await stay(U, 'Waiting stay', 'airbnb', 'HMWAIT0001', '2025-09-03', '2025-09-06', 40000);
  await stay(U, 'Cancelled stay', 'airbnb', 'HMGONE0001', '2025-09-10', '2025-09-12', 30000, 'cancelled');
  const DIRECT_U = await stay(U, 'Direct no amount', 'direct', null, '2025-09-15', '2025-09-17', null);
  await as(ACCOUNTS);
  const error = await finance({ action: 'prepareStatement', propertyId: U, period: '2025-09' }).then(() => null, e => e);
  assert.match(error.message, /Reconcile every stay in the period first/);
  assert.deepEqual(JSON.parse(error.detail), [`stay_unsettled:${WAIT}`, `stay_unsettled:${DIRECT_U}`]);
  // An unsettled stay and an unreviewed dear clean: both reasons in one message.
  const dear = await clean(U, '2025-09-06', users[CLEANER_C]);
  await sql('insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values($1,9000,$2)', [users[CLEANER_C], users[ADMIN]]);
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'prepareStatement', propertyId: U, period: '2025-09' }), /Reconcile every stay in the period and review the cleans/);
  // A statement that ends before the unsettled stays can be prepared.
  await payables({ action: 'reviewCleanCost', workId: dear, decision: 'agreed_fee', note: 'Rate rise not passed on' });
  const early = await finance({ action: 'prepareStatement', propertyId: U, from: '2025-09-01', to: '2025-09-03' });
  assert.deepEqual([early.grossMinor, early.nightsBooked, early.nightsAvailable], [0, 0, 2]);
});

test('no double counting against old-style monthly statements', async () => {
  await as(ADMIN);
  const OLD = await property('Old statements house');
  await as(ADMIN); await terms(OLD, { vatOnFee: false });
  const S1 = await stay(OLD, 'Late October', 'direct', null, '2025-10-29', '2025-11-02', 48000);
  const S2 = await stay(OLD, 'November', 'direct', null, '2025-11-05', '2025-11-07', 20000);
  // October's statement as the old prepareStatement wrote it: the whole of S1, where it checks in. No end date given.
  await sql(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
    values($1,'2025-10-01','issued',48000,0,0,0,1500,7200,40800,$2::jsonb,$3,now())`,
    [OLD, JSON.stringify({ stays: [{ reservationId: S1, reference: 'Late October', channel: 'direct', checkIn: '2025-10-29', checkOut: '2025-11-02', amountMinor: 48000 }], expenses: [], cleaningCostMinor: 6000 }), users[ADMIN]]);
  const [old] = await sql("select period_end::text,method from private.workspace_owner_statements where property_id=$1", [OLD]);
  assert.deepEqual(old, { period_end: '2025-11-01', method: 'check_in_month' }, 'an old statement ends with its month');
  await as(ACCOUNTS);
  const nov = await finance({ action: 'prepareStatement', propertyId: OLD, period: '2025-11' });
  assert.equal(nov.grossMinor, 20000, 'S1 was paid in October; only its night counts');
  assert.equal(nov.nightsBooked, 1 + 2);
  assert.deepEqual(nov.detail.alreadyCounted, [S1]);
  assert.deepEqual(nov.detail.stays.map(x => [x.reservationId, x.counted, x.amountMinor]), [[S1, false, 0], [S2, true, 20000]]);
  // statementFor with S1 as nights-only (the caller leaves already-counted revenue out).
  assert.deepEqual(figures(await compute(OLD, '2025-11-01', '2025-12-01')), figures(statementFor({ from: '2025-11-01', to: '2025-12-01', method: 'nights',
    terms: { managementFeeBps: 1500, vatOnFee: false, cleaningCostMinor: 6000, cleanChargeMode: 'agreed_fee' }, cleans: [], payables: [],
    stays: [{ id: S1, channel: 'direct', checkIn: '2025-10-29', checkOut: '2025-11-02', status: 'confirmed', settledMinor: null, ownerStay: true },
      { id: S2, channel: 'direct', checkIn: '2025-11-05', checkOut: '2025-11-07', status: 'confirmed', settledMinor: 20000 }] })));

  // The other way: a nights statement took December's share first, then November is prepared by check-in.
  await as(ADMIN);
  const MIX = await property('Mixed methods house');
  await as(ADMIN); await terms(MIX, { vatOnFee: false });
  const X = await stay(MIX, 'Across the month end', 'direct', null, '2025-11-28', '2025-12-03', 50000);
  await as(ACCOUNTS);
  const decMix = await finance({ action: 'prepareStatement', propertyId: MIX, period: '2025-12' });
  assert.equal(decMix.grossMinor, 20000, 'two of its five nights');
  const novMix = await finance({ action: 'prepareStatement', propertyId: MIX, period: '2025-11', method: 'check_in_month' });
  assert.equal(novMix.method, 'check_in_month');
  assert.equal(novMix.grossMinor, 0, 'its money is already in December’s statement');
  assert.deepEqual(novMix.detail.alreadyCounted, [X]);
  // Voiding December frees it, and November counts it whole.
  await finance({ action: 'voidStatement', statementId: decMix.id, version: decMix.version, reason: 'Prepared by the wrong method' });
  assert.equal((await finance({ action: 'prepareStatement', propertyId: MIX, period: '2025-11', method: 'check_in_month' })).grossMinor, 50000);
});

test('the SQL pro-rating and rounding are exact for large and negative amounts', async () => {
  const random = generator(424242), int = (low, high) => low + Math.floor(random() * (high - low + 1));
  const cases = [];
  for (let i = 0; i < 300; i++) {
    const nights = int(1, 400), before = int(0, nights), through = int(before, nights);
    cases.push([(int(0, 1) ? 1 : -1) * int(0, Number.MAX_SAFE_INTEGER), before, through, nights]);
  }
  cases.push([72000, 0, 5, 7], [72000, 5, 7, 7], [-7, 0, 1, 2], [-7, 1, 2, 2]);
  const rows = await sql(`select private.workspace_prorate(x::bigint,b,t,n)::text v from jsonb_to_recordset($1::jsonb) as c(x text,b int,t int,n int)`,
    [JSON.stringify(cases.map(([x, b, t, n]) => ({ x: String(x), b, t, n })))]);
  rows.forEach((r, i) => assert.equal(r.v, String(prorate(...cases[i])), `prorate case ${i}`));
  await assert.rejects(sql('select private.workspace_prorate(100,2,1,3)'), /0 <= before <= through <= nights/);
  // Halves away from zero, on any size.
  const half = (minor, bps) => { const p = BigInt(minor) * BigInt(bps), q = p / 10000n, r = p % 10000n; return (r < 0n ? -r : r) * 2n >= 10000n ? q + (p < 0n ? -1n : 1n) : q; };
  const money = [];
  for (let i = 0; i < 300; i++) money.push([(int(0, 1) ? 1 : -1) * int(0, 2 ** 40), int(0, 10000)]);
  money.push([30, 1500], [10, 1500], [3, 1500], [-30, 1500], [4, 1250], [20, 1250], [162002, 1500], [24300, VAT_BPS]);
  const fees = await sql(`select private.workspace_percent_of_minor(m::bigint,b)::text v from jsonb_to_recordset($1::jsonb) as c(m text,b int)`, [JSON.stringify(money.map(([m, b]) => ({ m: String(m), b })))]);
  fees.forEach((r, i) => assert.equal(r.v, String(half(...money[i])), `percent case ${i}`));
});

// ---- 200 seeded random scenarios: the SQL equals statementFor ------------------------------------------
function generator(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const isoDay = n => new Date(n * 86400000).toISOString().slice(0, 10);

test('200 seeded random scenarios: the SQL statement equals statementFor', async () => {
  const random = generator(20261012), int = (low, high) => low + Math.floor(random() * (high - low + 1)), pick = list => list[int(0, list.length - 1)];
  const chance = p => random() < p;
  const day0 = Date.UTC(2024, 0, 1) / 86400000;
  const cleaners = [users[CLEANER_A], users[CLEANER_B], users[CLEANER_C]];
  let prepared = 0, blockedCount = 0, withOldStatement = 0, withOwnerStay = 0, proRated = 0;
  for (let i = 0; i < 200; i++) {
    const label = `scenario ${i}`;
    // Owner stays share one code index across the database: keep at most one alive.
    await sql("delete from private.workspace_reservations where channel='other' and channel_reference='Owner stay'");
    const prop = await property(`Random ${i}`);
    const t = { managementFeeBps: pick([1200, 1500, 1250, 0, 10000, int(0, 10000)]), vatOnFee: chance(0.6), cleaningCostMinor: pick([0, 6000, int(1, 20000)]), cleanChargeMode: chance(0.6) ? 'agreed_fee' : 'actual_cost' };
    await sql('insert into private.workspace_property_financials(property_id,management_fee_bps,cleaning_cost_minor,vat_on_fee,clean_charge_mode) values($1,$2,$3,$4,$5)',
      [prop, t.managementFeeBps, t.cleaningCostMinor, t.vatOnFee, t.cleanChargeMode]);
    const fromN = day0 + int(0, 600), toN = fromN + int(1, 100), from = isoDay(fromN), to = isoDay(toN), method = chance(0.7) ? 'nights' : 'check_in_month';
    // The cleaners' rates for this scenario (the third cleaner has none).
    const rates = { [cleaners[0]]: int(1, 20000), [cleaners[1]]: int(1, 20000) };
    await sql('delete from private.workspace_cleaner_rates where cleaner_id=$1', [cleaners[2]]);
    for (const [who, rate] of Object.entries(rates)) await sql('insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values($1,$2,$3) on conflict(cleaner_id) do update set rate_minor=excluded.rate_minor', [who, rate, users[ADMIN]]);

    const tsStays = [];
    let ownerUsed = false;
    for (let k = 0; k < int(0, 6); k++) {
      let channel = pick(['airbnb', 'booking_com', 'vrbo', 'direct', 'direct', 'other', 'owner']);
      if (channel === 'owner' && ownerUsed) channel = 'direct';
      const checkInN = fromN + int(-40, toN - fromN + 10), checkOutN = checkInN + int(1, 40);
      const status = pick(['confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'confirmed', 'cancelled', 'enquiry']);
      const amount = chance(0.1) ? int(0, 99990000) : int(0, 5000000);
      const ota = ['airbnb', 'booking_com', 'vrbo'].includes(channel);
      const code = ota ? `R${i}-${k}-${int(0, 1e9)}` : channel === 'owner' ? 'Owner stay' : null;
      let payout = amount, settled = null, fee = null, model = null;
      if (ota) {
        model = pick(['matched', 'matched', 'matched', 'agreed', 'agreedBeforeFunds', 'different', 'none', 'noReference']);
        if (model === 'agreed' || model === 'different') payout = amount + int(1, 5000);
      } else if (channel === 'owner') payout = pick([0, 0, null, 500]);
      else payout = chance(0.15) ? null : amount;
      const id = await stay(prop, `S${k}`, channel === 'owner' ? 'other' : channel, model === 'noReference' ? null : code, isoDay(checkInN), isoDay(checkOutN), payout, status);
      if (channel === 'owner') { ownerUsed = true; withOwnerStay++; }
      if (ota && ['matched', 'agreed', 'different'].includes(model)) {
        const lineAmount = amount; // what was received
        const feeKind = pick(['itemised', 'itemised', 'gross', 'none']);
        const parts = { commission: null, host: null, payment: null };
        let gross = null;
        if (feeKind === 'itemised') {
          for (const p of Object.keys(parts)) if (chance(0.6)) parts[p] = chance(0.1) ? int(-5000, 0) : int(0, 800000);
          if (parts.commission === null && parts.host === null && parts.payment === null) parts.host = int(0, 800000);
          fee = (parts.commission ?? 0) + (parts.host ?? 0) + (parts.payment ?? 0);
        } else if (feeKind === 'gross') { gross = Math.min(100000000, lineAmount + int(-1000, 1000000)); fee = gross - lineAmount; }
        const [rep] = await sql(`insert into private.workspace_payout_reports(channel,file_name,content_hash,line_count,total_minor,new_line_count,new_minor,uploaded_by,request_id)
          values($1,'random.csv',md5(random()::text),1,$2,1,$2,$3,gen_random_uuid()) returning id`, [channel, lineAmount, users[ACCOUNTS]]);
        await sql(`insert into private.workspace_payout_lines(report_id,channel,reference,amount_minor,gross_minor,commission_minor,host_fee_minor,payment_fee_minor) values($1,$2,$3,$4,$5,$6,$7,$8)`,
          [rep.id, channel, code, lineAmount, gross, parts.commission, parts.host, parts.payment]);
        if (model === 'matched') settled = lineAmount;
        if (model === 'agreed') {
          settled = int(0, 10000000);
          await sql('insert into private.workspace_payout_agreements(reservation_id,received_snapshot_minor,agreed_minor,note,agreed_by) values($1,$2,$3,$4,$5)', [id, lineAmount, settled, 'Agreed in a test', users[ACCOUNTS]]);
        }
      } else if (ota && model === 'agreedBeforeFunds') {
        settled = int(0, 10000000);
        await sql('insert into private.workspace_payout_agreements(reservation_id,received_snapshot_minor,agreed_minor,note,agreed_by) values($1,null,$2,$3,$4)', [id, settled, 'Agreed in a test', users[ACCOUNTS]]);
      } else if (!ota) settled = payout;
      tsStays.push({ id, channel: channel === 'owner' ? 'other' : channel, checkIn: isoDay(checkInN), checkOut: isoDay(checkOutN), status, settledMinor: settled, itemisedFeesMinor: fee, ownerStay: channel === 'owner' });
    }
    // Sometimes an old statement of the other method already holds some of these stays' money.
    if (tsStays.length && chance(0.2)) {
      withOldStatement++;
      const held = tsStays.filter(() => chance(0.5));
      await sql(`insert into private.workspace_owner_statements(property_id,period_start,period_end,method,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by)
        values($1,'2020-01-01','2020-02-01',$2,'issued',0,0,0,0,0,0,0,$3::jsonb,$4)`, [prop, method === 'nights' ? 'check_in_month' : 'nights', JSON.stringify({ stays: held.map(s => ({ reservationId: s.id })) }), users[ADMIN]]);
      // statementFor: the caller leaves that revenue out, so those stays count their nights only.
      for (const s of held) if (!s.ownerStay) Object.assign(s, { ownerStay: true, settledMinor: null });
    }

    const tsCleans = [];
    for (let k = 0; k < int(0, 5); k++) {
      const dueN = fromN + int(-5, toN - fromN + 5);
      const assignee = pick([...cleaners, null]);
      const billable = chance(0.8);
      const id = await clean(prop, isoDay(dueN), assignee, billable ? {} : pick([{ status: 'waiting', phase: 'assigned' }, { status: 'completed', phase: 'assigned' }]));
      let actual = assignee && rates[assignee] !== undefined ? rates[assignee] : null;
      const invoiceBy = assignee ?? cleaners[0];
      if (chance(0.15)) {
        const [inv] = await sql("insert into private.workspace_cleaner_invoices(supplier,cleaner_id,reference,invoice_date,total_minor,status,created_by,request_id) values('Random cleaner',$1,$2,'2025-01-01',$3,'rejected',$4,gen_random_uuid()) returning id", [invoiceBy, `X-${i}-${k}`, 100, users[ACCOUNTS]]);
        await sql('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor,live) values($1,$2,$3,$4,false)', [inv.id, id, prop, int(1, 30000)]);
      }
      if (chance(0.4)) {
        const amount = int(1, 30000);
        const [inv] = await sql("insert into private.workspace_cleaner_invoices(supplier,cleaner_id,reference,invoice_date,total_minor,created_by,request_id) values('Random cleaner',$1,$2,'2025-01-01',$3,$4,gen_random_uuid()) returning id", [invoiceBy, `L-${i}-${k}`, amount, users[ACCOUNTS]]);
        await sql('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor) values($1,$2,$3,$4)', [inv.id, id, prop, amount]);
        actual = amount;
      }
      let decision = null, reviewed = false;
      if (chance(0.4)) {
        decision = chance(0.5) ? 'agreed_fee' : 'actual_cost';
        const current = actual !== null && chance(0.7);
        await sql('insert into private.workspace_clean_cost_reviews(work_id,decision,note,actual_cost_minor,reviewed_by) values($1,$2,$3,$4,$5)', [id, decision, 'Reviewed in a test', current ? actual : (actual ?? 0) + 1, users[ACCOUNTS]]);
        reviewed = current;
      }
      if (billable) tsCleans.push({ id, date: isoDay(dueN), actualCostMinor: actual, decision, reviewed });
    }
    const tsPayables = [];
    for (let k = 0; k < int(0, 3); k++) {
      const date = isoDay(fromN + int(-3, toN - fromN + 3)), amount = int(1, 1000000), status = pick(['approved', 'approved', 'approved', 'to_approve', 'rejected']);
      const id = await expense(prop, date, `Expense ${i}-${k}`, amount, status);
      if (status === 'approved') tsPayables.push({ id, date, description: `Expense ${i}-${k}`, amountMinor: amount });
    }

    const ts = statementFor({ from, to, method, terms: t, stays: tsStays, cleans: tsCleans, payables: tsPayables });
    const c = await compute(prop, from, to, method);
    assert.deepEqual(figures(c), figures(ts), label);
    if (ts.stays.some(s => s.grossMinor !== 0 && s.nightsInPeriod < s.nights)) proRated++;
    if (ts.blocked) { blockedCount++; continue; }
    // Prepared and stored: the same figures.
    await asDb(); await db.exec('delete from private.workspace_write_limits');
    await as(ACCOUNTS);
    const s = await finance({ action: 'prepareStatement', propertyId: prop, from, to, method });
    prepared++;
    assert.deepEqual([s.grossMinor, s.otaFeesMinor, s.cleaningMinor, s.feeMinor, s.vatMinor, s.expensesMinor, s.payoutMinor, s.nightsBooked, s.nightsAvailable, s.revenueMinor, s.vatRateBps],
      [ts.grossMinor, ts.otaFeesMinor, ts.changeoversMinor, ts.feeMinor, ts.vatMinor, ts.payablesMinor, ts.payoutMinor, ts.nightsBooked, ts.nightsAvailable, ts.grossMinor - ts.otaFeesMinor, t.vatOnFee ? 2000 : 0], label);
    assert.equal(s.vatRateBps, t.vatOnFee ? 2000 : 0, label);
    assert.deepEqual(s.detail.lines.map(l => [l.kind, l.refId, l.amountMinor, l.date, l.label]), ts.lines.map(l => [l.kind, l.refId, l.amountMinor, l.date, l.label]), label);
    assert.deepEqual(s.detail.internal, ts.flags, label);
  }
  await sql("delete from private.workspace_reservations where channel='other' and channel_reference='Owner stay'");
  // The scenarios really exercised the paths that matter.
  assert.ok(prepared >= 40, `prepared ${prepared}`);
  assert.ok(blockedCount >= 20, `blocked ${blockedCount}`);
  assert.ok(withOldStatement >= 20, `old statements ${withOldStatement}`);
  assert.ok(withOwnerStay >= 20, `owner stays ${withOwnerStay}`);
  assert.ok(proRated >= 20, `pro-rated ${proRated}`);
});
