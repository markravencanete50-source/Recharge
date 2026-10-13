import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The Performance report (20261012130000): management fees and VAT from issued and paid statements, cleaning
// charged against what the same cleans cost, occupancy and the average nightly rate from stays shared by nights,
// filtered by property, region and channel. Finance roles and admins only. Every figure below was worked out by
// hand from the definitions before the report was run.
const MIGRATION = 'supabase/migrations/20261012130000_mid_stay_cleans_performance.sql';
const PROFIT_MIGRATION = 'supabase/migrations/20261014140000_clean_charge_agreed_fee.sql';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false } });
const { performanceReportSchema } = await vite.ssrLoadModule('/lib/performance.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'accounts', 'client', 'cleans', 'cleans', 'stays'];
const users = roles.map((_, i) => `f1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, ACCOUNTS, OWNER, CLEANER_A, CLEANER_B, STAYS] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `performance${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('f100', 'f200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('f100', 'f200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('f100', 'f200') })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const report = (from, to, { propertyId = null, id = null, filters = null } = {}) => rpc('workspace_finance_report', ['performance', propertyId, id, from, to, filters]);
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
// Every report is read as Accounts and checked against the screen's schema.
const perf = async (from, to, options) => { await as(ACCOUNTS); return performanceReportSchema.parse(await report(from, to, options)); };

async function property(name, region, status = 'active') {
  return (await sql('insert into public.workspace_properties(name,region,status,created_by,request_id) values($1,$2,$3,$4,gen_random_uuid()) returning id', [name, region, status, users[ADMIN]]))[0].id;
}
async function stay(prop, reference, channel, code, checkIn, checkOut, payout, status = 'confirmed') {
  return (await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,$5,'manual',$6,$7,$8) returning id`, [prop, reference, checkIn, checkOut, status, channel, code, payout]))[0].id;
}
async function clean(prop, dueOn, assignee) {
  const [w] = await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,due_on,assignee_id,created_by) values(gen_random_uuid(),$1,'cleaning-schedule','Clean','completed',$2,$3,$4) returning id",
    [prop, dueOn, assignee === null ? null : users[assignee], users[ADMIN]]);
  await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'cleaning','{\"phase\":\"accepted\",\"workStatus\":\"completed\"}'::jsonb)", [w.id]);
  return w.id;
}
// A statement as prepareStatement writes it; with `lines` it lists its changeovers (version 2), without them it is
// an older monthly statement that charged every billable clean in its month.
async function statement(prop, periodStart, status, { fee, vat = 0, cleaning, lines = null }) {
  const detail = lines ? { stays: [], expenses: [], lines: lines.map(([refId, date, amountMinor]) => ({ kind: 'changeover', date, label: 'Changeover clean', amountMinor, refId })) } : { stays: [], expenses: [] };
  return (await sql(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at,vat_bps,vat_minor)
    values($1,$2,$3,0,0,$4,0,1500,$5,0,$6::jsonb,$7,case when $3 in ('issued','paid') then now() end,case when $8::bigint>0 then 2000 else 0 end,$8) returning id`,
    [prop, periodStart, status, cleaning, fee, JSON.stringify(detail), users[ADMIN], vat]))[0].id;
}
const line = (channel, reference, amountMinor, { gross = null, hostFee = null } = {}) => ({
  reference, amountMinor, grossMinor: gross, commissionMinor: null, hostFeeMinor: hostFee, paymentFeeMinor: null, cleaningFeeMinor: null,
  paidOn: '2026-10-31', lineType: 'Reservation', key: [channel, reference.toUpperCase(), '2026-10-31', 'Reservation', amountMinor, 'PO-9', 1].join('|'),
});

// ---- The scenario: September and October 2026 (61 nights), two active properties -----------------------------
const HARBOUR = await property('Harbour Flat', 'Edinburgh');
const GLEN = await property('Glen Cottage', 'Highlands');
const BOTHY = await property('Old Bothy', 'Highlands', 'archived'); // archived, nothing in the window: left out
const LOFT = await property('New Loft', 'Edinburgh', 'onboarding'); // onboarding, nothing in the window: left out
await sql('insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values($1,5500,$3),($2,8000,$3)', [users[CLEANER_A], users[CLEANER_B], users[ADMIN]]);

// Harbour Flat stays.
await stay(HARBOUR, 'S1', 'airbnb', 'HMPERF0001', '2026-09-05', '2026-09-10', 50000); // 5 nights, settled 50000 + fee 1546 = gross 51546
await stay(HARBOUR, 'S2', 'direct', null, '2026-09-28', '2026-10-04', 60001); // 6 nights: Sep 3 (30000), Oct 3 (30001)
await stay(HARBOUR, 'S3', 'other', 'Owner stay', '2026-10-10', '2026-10-13', null); // owner stay: 3 booked nights, no money
await stay(HARBOUR, 'S4', 'direct', null, '2026-10-20', '2026-10-25', 99999, 'cancelled');
await stay(HARBOUR, 'S5', 'booking_com', '5550000101', '2026-10-30', '2026-11-02', 30000); // gross 36000, 2 of 3 nights: 24000
await stay(HARBOUR, 'S6', 'direct', null, '2026-10-15', '2026-10-18', 45000, 'enquiry');
// Glen Cottage stays.
await stay(GLEN, 'S7', 'vrbo', 'HA-PERF0001', '2026-09-15', '2026-09-19', 40000); // paid 41000: not settled, amount unknown
await stay(GLEN, 'S8', 'direct', null, '2026-10-01', '2026-10-08', 70000); // 7 nights, 70000
await as(ACCOUNTS);
await finance({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-perf.csv', lines: [line('airbnb', 'HMPERF0001', 50000, { hostFee: 1546 })] });
await finance({ action: 'importPayoutReport', channel: 'booking_com', fileName: 'booking-perf.csv', lines: [line('booking_com', '5550000101', 30000, { gross: 36000 })] });
await finance({ action: 'importPayoutReport', channel: 'vrbo', fileName: 'vrbo-perf.csv', lines: [line('vrbo', 'HA-PERF0001', 41000)] });

// Cleans: cleaner A costs 5500, cleaner B 8000, one clean has nobody on it (no cost known).
const CA1 = await clean(HARBOUR, '2026-09-10', CLEANER_A);
const CA2 = await clean(HARBOUR, '2026-09-28', CLEANER_A);
await clean(HARBOUR, '2026-09-20', CLEANER_B); // billable, but not on the itemised September statement: not counted
const CA3 = await clean(HARBOUR, '2026-10-04', CLEANER_B);
const CG1 = await clean(GLEN, '2026-10-08', CLEANER_B); // on Glen's older monthly statement, found by its month
await clean(GLEN, '2026-10-20', null);

// The cleans' actual cost is the cleaner's invoice line (client answer 4): the same amounts as the rates above.
for (const [workId, prop, amount, i] of [[CA1, HARBOUR, 5500, 1], [CA2, HARBOUR, 5500, 2], [CA3, HARBOUR, 8000, 3], [CG1, GLEN, 8000, 4]]) {
  const [inv] = await sql("insert into private.workspace_cleaner_invoices(supplier,reference,invoice_date,total_minor,created_by,request_id) values('Perf cleaner',$1,'2026-10-31',$2,$3,gen_random_uuid()) returning id", ['PERF-' + i, amount, users[ADMIN]]);
  await sql('insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor) values($1,$2,$3,$4)', [inv.id, workId, prop, amount]);
}

// Statements. Counted: Harbour September (issued), Harbour October (paid), Glen October (issued, an older monthly one).
await statement(HARBOUR, '2026-09-01', 'issued', { fee: 12000, vat: 2400, cleaning: 12000, lines: [[CA1, '2026-09-10', 6000], [CA2, '2026-09-28', 6000]] });
await statement(HARBOUR, '2026-10-01', 'paid', { fee: 15000, vat: 3000, cleaning: 6000, lines: [[CA3, '2026-10-04', 6000]] });
await statement(GLEN, '2026-10-01', 'issued', { fee: 10500, cleaning: 14000 });
// Not counted: a draft, a void one, one starting before the window and one starting on its end.
await statement(GLEN, '2026-09-01', 'draft', { fee: 9999, vat: 2000, cleaning: 7000 });
await statement(HARBOUR, '2026-10-15', 'void', { fee: 77777, cleaning: 0, lines: [] });
await statement(HARBOUR, '2026-08-01', 'issued', { fee: 8888, cleaning: 0, lines: [] });
await statement(GLEN, '2026-11-01', 'issued', { fee: 6666, cleaning: 0, lines: [] });

const FROM = '2026-09-01', TO = '2026-11-01';
const zeroMoney = { managementFeeMinor: 0, vatMinor: 0, cleaningChargedMinor: 0, cleaningCostMinor: 0, cleaningMarginMinor: 0, cleanCount: 0, cleansWithoutCost: 0, statementCount: 0,
  invoicedCleanCount: 0, invoicedChargedMinor: 0, invoicedCostMinor: 0, cleanProfitMinor: 0, profitPerCleanMinor: null };
const TOTALS = {
  managementFeeMinor: 37500, vatMinor: 5400, cleaningChargedMinor: 32000, cleaningCostMinor: 27000, cleaningMarginMinor: 5000,
  cleanCount: 5, cleansWithoutCost: 1, statementCount: 3,
  // Profit per clean: the cleans with an invoice and a charge on an itemised statement (Glen's older statement has none).
  invoicedCleanCount: 3, invoicedChargedMinor: 18000, invoicedCostMinor: 19000, cleanProfitMinor: -1000, profitPerCleanMinor: -333,
  grossRevenueMinor: 205547, nightsBooked: 27, nightsAvailable: 122, occupancyBps: 2213, nightsSold: 20, averageNightlyRateMinor: 10277,
};
const GLEN_FIGURES = {
  managementFeeMinor: 10500, vatMinor: 0, cleaningChargedMinor: 14000, cleaningCostMinor: 8000, cleaningMarginMinor: 6000, cleanCount: 2, cleansWithoutCost: 1, statementCount: 1,
  invoicedCleanCount: 0, invoicedChargedMinor: 0, invoicedCostMinor: 0, cleanProfitMinor: 0, profitPerCleanMinor: null,
  grossRevenueMinor: 70000, nightsBooked: 11, nightsAvailable: 61, occupancyBps: 1803, nightsSold: 7, averageNightlyRateMinor: 10000,
};
const HARBOUR_FIGURES = {
  managementFeeMinor: 27000, vatMinor: 5400, cleaningChargedMinor: 18000, cleaningCostMinor: 19000, cleaningMarginMinor: -1000, cleanCount: 3, cleansWithoutCost: 0, statementCount: 2,
  invoicedCleanCount: 3, invoicedChargedMinor: 18000, invoicedCostMinor: 19000, cleanProfitMinor: -1000, profitPerCleanMinor: -333,
  grossRevenueMinor: 135547, nightsBooked: 16, nightsAvailable: 61, occupancyBps: 2623, nightsSold: 13, averageNightlyRateMinor: 10427,
};

test('a multi-property window: totals, each property and each month, worked out by hand', async () => {
  const r = await perf(FROM, TO);
  assert.deepEqual(r.totals, TOTALS);
  assert.deepEqual(r.byProperty, [
    { propertyId: GLEN, propertyName: 'Glen Cottage', region: 'Highlands', ...GLEN_FIGURES },
    { propertyId: HARBOUR, propertyName: 'Harbour Flat', region: 'Edinburgh', ...HARBOUR_FIGURES },
  ], 'the archived and onboarding properties with nothing in the window are left out');
  assert.deepEqual(r.byMonth, [
    { period: '2026-09', from: '2026-09-01', to: '2026-10-01', managementFeeMinor: 12000, vatMinor: 2400, cleaningChargedMinor: 12000, cleaningCostMinor: 11000, cleaningMarginMinor: 1000,
      cleanCount: 2, cleansWithoutCost: 0, statementCount: 1, invoicedCleanCount: 2, invoicedChargedMinor: 12000, invoicedCostMinor: 11000, cleanProfitMinor: 1000, profitPerCleanMinor: 500,
      grossRevenueMinor: 81546, nightsBooked: 12, nightsAvailable: 60, occupancyBps: 2000, nightsSold: 8, averageNightlyRateMinor: 10193 },
    { period: '2026-10', from: '2026-10-01', to: '2026-11-01', managementFeeMinor: 25500, vatMinor: 3000, cleaningChargedMinor: 20000, cleaningCostMinor: 16000, cleaningMarginMinor: 4000,
      cleanCount: 3, cleansWithoutCost: 1, statementCount: 2, invoicedCleanCount: 1, invoicedChargedMinor: 6000, invoicedCostMinor: 8000, cleanProfitMinor: -2000, profitPerCleanMinor: -2000,
      grossRevenueMinor: 124001, nightsBooked: 15, nightsAvailable: 62, occupancyBps: 2419, nightsSold: 12, averageNightlyRateMinor: 10333 },
  ]);
  // The parts add up to the whole, exactly.
  for (const key of ['managementFeeMinor', 'vatMinor', 'cleaningChargedMinor', 'cleaningCostMinor', 'grossRevenueMinor', 'nightsBooked', 'nightsAvailable', 'nightsSold']) {
    assert.equal(r.byMonth.reduce((s, m) => s + m[key], 0), r.totals[key], `months add up: ${key}`);
    assert.equal(r.byProperty.reduce((s, p) => s + p[key], 0), r.totals[key], `properties add up: ${key}`);
  }
  assert.deepEqual(r.byChannel, [
    { channel: 'airbnb', nightsBooked: 5, occupancyBps: 410, grossRevenueMinor: 51546, nightsSold: 5, averageNightlyRateMinor: 10309 },
    { channel: 'booking_com', nightsBooked: 2, occupancyBps: 164, grossRevenueMinor: 24000, nightsSold: 2, averageNightlyRateMinor: 12000 },
    { channel: 'vrbo', nightsBooked: 4, occupancyBps: 328, grossRevenueMinor: 0, nightsSold: 0, averageNightlyRateMinor: null },
    { channel: 'direct', nightsBooked: 13, occupancyBps: 1066, grossRevenueMinor: 130001, nightsSold: 13, averageNightlyRateMinor: 10000 },
    { channel: 'other', nightsBooked: 3, occupancyBps: 246, grossRevenueMinor: 0, nightsSold: 0, averageNightlyRateMinor: null },
  ]);
  assert.deepEqual([r.section, r.from, r.to, r.days, r.filters], ['performance', FROM, TO, 61, { propertyId: null, region: null, channel: null }]);
});

test('VAT is shown on its own and is never income; drafts, void and out-of-window statements are left out', async () => {
  const r = await perf(FROM, TO);
  assert.equal(r.totals.managementFeeMinor, 12000 + 15000 + 10500, 'fees only, without the 5400 of VAT');
  assert.equal(r.totals.vatMinor, 2400 + 3000);
  assert.equal(r.totals.statementCount, 3);
  // A statement starting on the window's first day counts; one starting on its end (1 November) does not.
  const october = await perf('2026-10-01', '2026-11-01');
  assert.equal(october.totals.managementFeeMinor, 15000 + 10500);
});

test('the cleaning margin can be negative, and a clean with no known cost is counted as such', async () => {
  const r = await perf(FROM, TO, { propertyId: HARBOUR });
  assert.equal(r.totals.cleaningMarginMinor, -1000);
  assert.deepEqual(r.byMonth.map(m => [m.period, m.cleaningChargedMinor, m.cleaningCostMinor, m.cleaningMarginMinor]), [['2026-09', 12000, 11000, 1000], ['2026-10', 6000, 8000, -2000]]);
  const glen = await perf(FROM, TO, { propertyId: GLEN });
  assert.deepEqual([glen.totals.cleanCount, glen.totals.cleansWithoutCost, glen.totals.cleaningCostMinor], [2, 1, 8000]);
});

test('filters narrow by property, region and channel; the channel filter changes stays only', async () => {
  const glen = await perf(FROM, TO, { propertyId: GLEN });
  assert.deepEqual(glen.totals, GLEN_FIGURES);
  assert.deepEqual(glen.byProperty.map(p => p.propertyId), [GLEN]);
  // The same property through the filters object, and by region (any case, spaces trimmed).
  assert.deepEqual((await perf(FROM, TO, { filters: { propertyId: GLEN } })).totals, GLEN_FIGURES);
  const highlands = await perf(FROM, TO, { filters: { region: ' highlands ' } });
  assert.deepEqual(highlands.totals, GLEN_FIGURES, 'the archived Highlands bothy adds no nights');
  assert.equal(highlands.filters.region, 'highlands');

  const direct = await perf(FROM, TO, { filters: { channel: 'direct' } });
  assert.deepEqual(direct.totals, { ...TOTALS, grossRevenueMinor: 130001, nightsBooked: 13, occupancyBps: 1066, nightsSold: 13, averageNightlyRateMinor: 10000 });
  assert.deepEqual(direct.byChannel.map(c => c.channel), ['direct']);

  const owners = await perf(FROM, TO, { filters: { channel: 'other' } });
  assert.deepEqual([owners.totals.nightsBooked, owners.totals.grossRevenueMinor, owners.totals.nightsSold, owners.totals.averageNightlyRateMinor], [3, 0, 0, null]);

  const both = await perf(FROM, TO, { filters: { region: 'Edinburgh', channel: 'airbnb' } });
  assert.deepEqual(both.totals, { ...HARBOUR_FIGURES, grossRevenueMinor: 51546, nightsBooked: 5, occupancyBps: 820, nightsSold: 5, averageNightlyRateMinor: 10309 });

  // A property asked for by name is shown even with nothing in the window.
  const loft = await perf(FROM, TO, { propertyId: LOFT });
  assert.deepEqual(loft.totals, { ...zeroMoney, grossRevenueMinor: 0, nightsBooked: 0, nightsAvailable: 61, occupancyBps: 0, nightsSold: 0, averageNightlyRateMinor: null });
  assert.deepEqual((await perf(FROM, TO, { propertyId: BOTHY })).byProperty.map(p => p.propertyName), ['Old Bothy']);
});

test('an empty period returns zeros and no nightly rate', async () => {
  const r = await perf('2027-03-01', '2027-04-01');
  assert.deepEqual(r.totals, { ...zeroMoney, grossRevenueMinor: 0, nightsBooked: 0, nightsAvailable: 62, occupancyBps: 0, nightsSold: 0, averageNightlyRateMinor: null });
  assert.deepEqual(r.byMonth.map(m => [m.period, m.nightsAvailable, m.occupancyBps, m.averageNightlyRateMinor]), [['2027-03', 62, 0, null]]);
  assert.deepEqual(r.byChannel, []);
  // No property in view at all: nothing is available, so there is no occupancy either.
  const none = await perf('2027-03-01', '2027-04-01', { filters: { region: 'Nowhere' } });
  assert.deepEqual([none.totals.nightsAvailable, none.totals.occupancyBps, none.byProperty.length], [0, null, 0]);
});

test('a window part-way through months shares stays by nights and keeps whole statements', async () => {
  // 29 Sep to 2 Oct: S2 has 3 of its 6 nights here (29, 30 Sep and 1 Oct) and S8 one (1 Oct).
  const r = await perf('2026-09-29', '2026-10-02');
  // S2 (checks in 28 Sep, 6 nights): before 1, through 4: floor(60001*4/6) - floor(60001*1/6) = 40000 - 10000 = 30000,
  // of which September (through 3) is 30000 - 10000 = 20000 and October 10000. S8: before 0, through 1: floor(70000/7) = 10000.
  assert.deepEqual([r.totals.nightsBooked, r.totals.grossRevenueMinor, r.totals.nightsSold, r.totals.averageNightlyRateMinor], [4, 40000, 4, 10000]);
  assert.deepEqual(r.byMonth.map(m => [m.period, m.from, m.to, m.nightsBooked, m.grossRevenueMinor, m.nightsAvailable]),
    [['2026-09', '2026-09-29', '2026-10-01', 2, 20000, 4], ['2026-10', '2026-10-01', '2026-10-02', 2, 20000, 2]]);
  // The October statements start inside the window and count whole; the September one does not.
  assert.equal(r.totals.managementFeeMinor, 25500);
});

test('dates and filters are checked', async () => {
  await as(ACCOUNTS);
  await assert.rejects(report('2026-09-01', '2026-09-01'), /end must be after the start/);
  await assert.rejects(report('2026-10-01', '2026-09-01'), /Choose a date range/);
  await assert.rejects(report(null, '2026-09-01'), /end must be after the start/);
  await assert.rejects(report('2026-01-01', '2027-01-03'), /up to a year/);
  assert.equal((await report('2026-01-01', '2027-01-02')).days, 366);
  for (const filters of [{ channel: 'expedia' }, { channel: 7 }, { status: 'issued' }, { propertyId: 'not-an-id' }, { region: '' }, { region: 'x'.repeat(201) }]) {
    await assert.rejects(report(FROM, TO, { filters }), /Invalid report filters/, JSON.stringify(filters));
  }
  await assert.rejects(report(FROM, TO, { propertyId: GLEN, filters: { propertyId: HARBOUR } }), /Invalid report filters/);
  await assert.rejects(report(FROM, TO, { id: crypto.randomUUID() }), /Invalid report filters/);
});

test('admins read it too; owners, cleaners and the Stays team get nothing', async () => {
  await as(ADMIN);
  assert.deepEqual(performanceReportSchema.parse(await report(FROM, TO)).totals, TOTALS);
  for (const who of [OWNER, CLEANER_A, STAYS]) {
    await as(who);
    await assert.rejects(report(FROM, TO), /Accounts access required/);
    await assert.rejects(report(FROM, TO, { propertyId: HARBOUR }), /Accounts access required|Property finance access denied/);
    await assert.rejects(db.query("select private.workspace_report_performance(null,null,'2026-09-01','2026-11-01',null)"), /permission denied/);
  }
  await asDb();
  for (const fn of ['private.workspace_report_performance(uuid,uuid,date,date,jsonb)', 'private.workspace_performance_round(numeric,numeric)']) {
    assert.equal((await db.query(`select has_function_privilege('authenticated','${fn}','execute') ok`)).rows[0].ok, false, fn);
  }
});

test('the migration runs twice and the figures do not change', async () => {
  await asDb();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  // The report is replaced by 20261014140000 (profit per clean); run it again after, twice, as the live order would.
  await db.exec(await fs.readFile(PROFIT_MIGRATION, 'utf8'));
  await db.exec(await fs.readFile(PROFIT_MIGRATION, 'utf8'));
  assert.deepEqual((await perf(FROM, TO)).totals, TOTALS);
});
