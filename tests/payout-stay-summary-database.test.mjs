import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The "Approve the payout" summary (20261015110000, lib/payout-summary.ts): the 'payoutStay' report fills in what the
// reconciliation row lacks, for finance roles only, and the sheet lists every field for a matched and an unmatched stay.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { financeActionSchema, financeReadSchema, prepareFinanceAction } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const summary = await vite.ssrLoadModule('/lib/payout-summary.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });
const roles = ['super_admin', 'admin', 'accounts', 'stays'];
const users = roles.map((_, i) => `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, , ACCOUNTS, STAYS] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `stay${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('e100', 'e200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('e100', 'e200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('e100', 'e200') })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const write = input => {
  const prepared = prepareFinanceAction(financeActionSchema.parse({ requestId: crypto.randomUUID(), ...input }));
  if ('error' in prepared) throw new Error(prepared.error);
  return rpc('workspace_finance_action', [prepared.input]);
};
const report = query => { const q = financeReadSchema.parse(query); return rpc('workspace_finance_report', [q.section, q.propertyId ?? null, q.id ?? null, q.from ?? null, q.to ?? null, null]); };
const read = query => { const q = financeReadSchema.parse(query); return rpc('workspace_finance_read', [q.section, q.propertyId ?? null, q.period ?? null, q.id ?? null, q.status ?? null]); };
const month = (await db.query("select to_char(current_date,'YYYY-MM') m,(date_trunc('month',current_date)+interval '1 day')::date::text first")).rows[0];
const plusDays = async (iso, days) => (await db.query('select ($1::date+$2::int)::text d', [iso, days])).rows[0].d;
const rows = async () => live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: month.m })).rows;

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Summary flat', address: '4 Summary Street, Leith', region: 'Edinburgh', bedrooms: 2 }]);
await rpc('workspace_assign_property', [property, users[STAYS], 'staff']);
const PLAN = [
  { ref: 'Summary stay 1', code: 'HMSUMM0001', expected: 30687 },
  { ref: 'Summary stay 2', code: 'HMSUMM0002', expected: 40000 },
];
await as(STAYS);
for (const [i, s] of PLAN.entries()) {
  const checkIn = await plusDays(month.first, i * 5);
  await rpc('workspace_operations_action', [operationsActionSchema.parse({ action: 'recordReservation', requestId: crypto.randomUUID(), propertyId: property, reference: s.ref, checkIn, checkOut: await plusDays(checkIn, 3), status: 'confirmed' })]);
}
await as(ACCOUNTS);
{
  const pending = live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: month.m })).needsDetails;
  for (const s of PLAN) {
    const p = pending.find(r => r.reference === s.ref);
    await write({ action: 'setReservationFinancials', propertyId: p.propertyId, reservationId: p.reservationId, version: p.version, channel: 'airbnb', channelReference: s.code, guests: 3, payoutMinor: s.expected });
  }
  // Stay 2 is paid twice the same amount on an overlapping report, so it reads as different with a repeated amount.
  const csv = 'Date,Type,Confirmation Code,Guest,Amount,Paid Out\n10/01/2026,Reservation,HMSUMM0002,Guest B,200.00,\n10/02/2026,Reservation,HMSUMM0002,Guest B,200.00,';
  await write({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-october.csv', csv });
}
test('the payoutStay report: property, status, guests, nights, matched lines, statement; finance roles only', async () => {
  await as(ACCOUNTS);
  const all = await rows();
  const [one, two] = PLAN.map(s => all.find(r => r.reference === s.ref));
  const a = summary.payoutStaySchema.parse(await report({ section: 'payoutStay', id: one.reservationId }));
  assert.deepEqual([a.propertyName, a.propertyAddress, a.status, a.guests, a.nights, a.lines, a.statement, a.locked, a.changedSinceStatement, a.differentAfterStatement],
    ['Summary flat', '4 Summary Street, Leith', 'confirmed', 3, 3, [], null, false, false, false]);
  const b = summary.payoutStaySchema.parse(await report({ section: 'payoutStay', id: two.reservationId }));
  assert.deepEqual(b.lines.map(l => [l.reference, l.amountMinor, l.fileName, l.active]), [['HMSUMM0002', 20000, 'airbnb-october.csv', true], ['HMSUMM0002', 20000, 'airbnb-october.csv', true]]);
  assert.equal(financeReadSchema.safeParse({ section: 'payoutStay' }).success, false, 'a stay is needed');
  await assert.rejects(report({ section: 'payoutStay', id: crypto.randomUUID() }), /Stay not found/);
  for (const who of [STAYS]) { await as(who); await assert.rejects(report({ section: 'payoutStay', id: one.reservationId }), /Accounts access required/); }
});

test('the sheet lists every field for an unmatched stay and for a matched one', async () => {
  await as(ACCOUNTS);
  const all = await rows();
  const [one, two] = PLAN.map(s => all.find(r => r.reference === s.ref));
  const values = s => Object.fromEntries(s.groups.flatMap(g => g.items.map(i => [i.label, i.value])));
  // Unmatched: nothing received yet.
  const a = summary.payoutSummary(one, summary.payoutStaySchema.parse(await report({ section: 'payoutStay', id: one.reservationId })));
  assert.deepEqual(a.groups.map(g => g.title), ['Property', 'Guest', 'Platform and booking', 'Stay', 'Money']);
  const va = values(a);
  assert.deepEqual([va.Property, va.Address, va.Guests, va.Platform, va['Reservation code'], va['Hostaway reference'], va.Nights, va.Expected, va.Received],
    ['Summary flat', '4 Summary Street, Leith', '3', 'Airbnb', 'HMSUMM0001', 'Summary stay 1', '3', '£306.87', 'Not received yet']);
  assert.ok(va.Guest, 'a guest line is always there, even when the name is not known');
  assert.equal(va.Difference, undefined, 'no difference before any money arrives');
  assert.deepEqual([a.lines, a.warnings], [[], []]);
  assert.match(summary.approvalLine(one, 30687, null), /^Approving marks this stay's money as agreed at £306\.87 before it arrives, for the .+ statement\.$/);
  // Matched lines, a difference and the repeated-amount warning.
  const b = summary.payoutSummary(two, summary.payoutStaySchema.parse(await report({ section: 'payoutStay', id: two.reservationId })));
  const vb = values(b);
  assert.deepEqual([vb.Expected, vb.Received, vb.Difference], ['£400.00', '£400.00', 'None']);
  assert.equal(b.lines.length, 2);
  assert.match(summary.approvalLine(two, 40000, null), /^Approving marks this stay's money as received at £400\.00 for the .+ statement\.$/);
});

test('warnings, the difference and the statement line, from the row and the report', () => {
  const row = { reservationId: crypto.randomUUID(), propertyId: crypto.randomUUID(), reference: 'HA:66902511', channel: 'booking_com', channelReference: null, checkIn: '2026-11-05', checkOut: '2026-11-08',
    guests: null, expectedMinor: 30687, receivedMinor: 29000, agreedMinor: null, agreementNote: null, state: 'different', version: 1, settledMinor: null, repeatedAmount: 14500, grossMinor: 34000, otaFeesMinor: 5000 };
  const stay = { reservationId: row.reservationId, propertyName: 'Pitt Street', propertyAddress: '', status: 'cancelled', guestName: 'Jo Guest', guests: 2, checkIn: row.checkIn, checkOut: row.checkOut, nights: 3,
    lines: [{ lineId: 'l', paidOn: '2026-11-09', uploadedAt: '2026-11-10T09:00:00Z', fileName: 'booking.csv', reference: '1234567890', amountMinor: 29000, grossMinor: null, active: true }],
    locked: true, statement: { id: 's', periodStart: '2026-11-01', periodEnd: '2026-11-30', status: 'issued' }, changedSinceStatement: true, differentAfterStatement: true };
  const s = summary.payoutSummary(row, stay, { propertyAddress: '12 Pitt Street, Edinburgh' });
  const v = Object.fromEntries(s.groups.flatMap(g => g.items.map(i => [i.label, [i.value, i.tone ?? null]])));
  assert.deepEqual([v.Guest[0], v.Guests[0], v.Address[0], v['Reservation code'], v.Difference, v.Gross[0], v['Platform fee'][0], v.Net[0]],
    ['Jo Guest', '2', '12 Pitt Street, Edinburgh', ['Not set', 'bad'], ['−£16.87', 'bad'], '£340.00', '£50.00', '£290.00']);
  assert.deepEqual(s.lines, [{ when: 'Mon 9 Nov 2026', reference: '1234567890 · booking.csv', amount: '£290.00', setAside: false }]);
  assert.deepEqual(s.warnings, ['This stay is cancelled.', '£145.00 appears on more than one payout line. It is often an overlapping report; check before approving.',
    'The money for this stay changed after its owner statement was issued.']);
  assert.equal(summary.approvalLine(row, 29000, stay), "Approving marks this stay's money as received at £290.00 for the November 2026 statement, which is already issued.");
  assert.equal(summary.approvalLine(row, null, stay), 'Enter the amount to approve.');
  // While the report loads, the row alone fills what it can.
  const loading = summary.payoutSummary(row, null, { propertyName: 'Pitt Street', loading: true });
  assert.equal(Object.fromEntries(loading.groups.flatMap(g => g.items.map(i => [i.label, i.value]))).Guest, 'Loading…');
  // The sheet keeps the amount, the note and the button, and never runs for owners (staff routes only).
  const sheet = readFileSync('mobile/src/PayoutApproveSheet.tsx', 'utf8');
  for (const needle of ['label="Amount to approve"', 'label="Why this amount is right"', '"Approve payout"', 'section: "payoutStay"', 'approvalLine(']) assert.ok(sheet.includes(needle), needle);
  assert.match(readFileSync('mobile/src/LiveAccounts.tsx', 'utf8'), /<PayoutApproveSheet /);
});
