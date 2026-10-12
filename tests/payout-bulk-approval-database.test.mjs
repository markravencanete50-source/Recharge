import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// "Approve all" on the Payouts list: one request approves many stays, each checked as a single
// approval is. The tests run the exact request the screen sends through the HTTP schema and the
// real database function, and check the screen's rules (lib/accounts-live.ts) agree with it.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { financeActionSchema, financeReadSchema, prepareFinanceAction, BULK_PAYOUT_LIMIT } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
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
const users = roles.map((_, i) => `d1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, STAYS] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `bulk${i}@example.com`]);
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
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const write = input => {
  const prepared = prepareFinanceAction(financeActionSchema.parse({ requestId: crypto.randomUUID(), ...input }));
  if ('error' in prepared) throw new Error(prepared.error);
  return rpc('workspace_finance_action', [prepared.input]);
};
const read = query => { const q = financeReadSchema.parse(query); return rpc('workspace_finance_read', [q.section, q.propertyId ?? null, q.period ?? null, q.id ?? null, q.status ?? null]); };
const month = (await db.query("select to_char(current_date,'YYYY-MM') m,(date_trunc('month',current_date)+interval '1 day')::date::text first")).rows[0];
const plusDays = async (iso, days) => (await db.query('select ($1::date+$2::int)::text d', [iso, days])).rows[0].d;
const rows = async () => live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: month.m })).rows;
const byRef = async ref => (await rows()).find(r => r.reference === ref);
const NOTE = 'Checked against the Airbnb earnings page';
const bulk = (items, extra = {}) => write({ action: 'agreePayouts', note: NOTE, items: items.map(r => ({ reservationId: r.reservationId, version: r.version })), ...extra });

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Bulk property' }]);
await rpc('workspace_assign_property', [property, users[STAYS], 'staff']);

// Six platform stays, three days apart so none overlap:
//   1 and 2 not paid yet, 3 paid less than expected, 4 paid exactly, 5 with no expected payout, 6 from Booking.com not paid yet.
const PLAN = [
  { ref: 'Bulk stay 1', channel: 'airbnb', code: 'HMBULK0001', expected: 30000 },
  { ref: 'Bulk stay 2', channel: 'airbnb', code: 'HMBULK0002', expected: 20000 },
  { ref: 'Bulk stay 3', channel: 'airbnb', code: 'HMBULK0003', expected: 40000 },
  { ref: 'Bulk stay 4', channel: 'airbnb', code: 'HMBULK0004', expected: 10000 },
  { ref: 'Bulk stay 5', channel: 'airbnb', code: 'HMBULK0005', expected: null },
  { ref: 'Bulk stay 6', channel: 'booking_com', code: '1234567890', expected: 25000 },
];
await as(STAYS);
for (const [i, s] of PLAN.entries()) {
  const checkIn = await plusDays(month.first, i * 3);
  await rpc('workspace_operations_action', [operationsActionSchema.parse({ action: 'recordReservation', requestId: crypto.randomUUID(), propertyId: property, reference: s.ref, checkIn, checkOut: await plusDays(checkIn, 2), status: 'confirmed' })]);
}
await as(ACCOUNTS);
{
  const pending = live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: month.m })).needsDetails;
  for (const s of PLAN) {
    const p = pending.find(r => r.reference === s.ref);
    await write({ action: 'setReservationFinancials', propertyId: p.propertyId, reservationId: p.reservationId, version: p.version, channel: s.channel, channelReference: s.code, guests: 2, payoutMinor: s.expected });
  }
  const csv = 'Date,Type,Confirmation Code,Guest,Amount,Paid Out\n10/01/2026,Reservation,HMBULK0003,Guest C,350.00,\n10/01/2026,Reservation,HMBULK0004,Guest D,100.00,';
  await write({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb.csv', csv });
}

test('the screen rules and the database agree on what each stay is and can do', async () => {
  await as(ACCOUNTS);
  const all = await rows();
  const state = Object.fromEntries(all.map(r => [r.reference, r.state]));
  assert.deepEqual(state, { 'Bulk stay 1': 'missing', 'Bulk stay 2': 'missing', 'Bulk stay 3': 'different', 'Bulk stay 4': 'matched', 'Bulk stay 5': 'missing', 'Bulk stay 6': 'missing' });
  const moves = Object.fromEntries(all.map(r => [r.reference, live.payoutMove(r)]));
  assert.deepEqual(moves, { 'Bulk stay 1': 'approve', 'Bulk stay 2': 'approve', 'Bulk stay 3': 'approve', 'Bulk stay 4': 'none', 'Bulk stay 5': 'details', 'Bulk stay 6': 'approve' });
  assert.deepEqual(live.payoutApproval(all.find(r => r.reference === 'Bulk stay 1')), { agreedMinor: 30000, basis: 'expected' });
  assert.deepEqual(live.payoutApproval(all.find(r => r.reference === 'Bulk stay 3')), { agreedMinor: 35000, basis: 'received' });
  assert.equal(live.payoutApproval(all.find(r => r.reference === 'Bulk stay 5')), null);
});

test('approve many at once: the expected amount for unpaid stays, differences left alone unless asked for', async () => {
  await as(ACCOUNTS);
  const all = await rows();
  const first = await bulk(all);
  const result = live.bulkApprovalSchema.parse(first);
  assert.equal(result.approved, 3);
  assert.equal(result.approvedMinor, 30000 + 20000 + 25000);
  assert.equal(result.atExpected, 3); assert.equal(result.atReceived, 0);
  assert.deepEqual(result.skipped, { changed: 0, settled: 1, needsDetails: 1, different: 1, locked: 0, notFound: 0 });

  const after = Object.fromEntries((await rows()).map(r => [r.reference, r]));
  for (const ref of ['Bulk stay 1', 'Bulk stay 2', 'Bulk stay 6']) assert.equal(after[ref].state, 'agreed', ref);
  assert.equal(after['Bulk stay 1'].agreedMinor, 30000); assert.equal(after['Bulk stay 6'].settledMinor, 25000);
  assert.ok(after['Bulk stay 1'].agreementNote.startsWith(NOTE + ' '), 'the note the person wrote comes first');
  assert.match(after['Bulk stay 1'].agreementNote, /Approved at the expected amount, before the payout arrived\.$/);
  assert.equal(after['Bulk stay 3'].state, 'different'); assert.equal(after['Bulk stay 4'].state, 'matched'); assert.equal(after['Bulk stay 5'].state, 'missing');
  // One activity entry per approved stay, the same as approving them one at a time.
  await as(SUPER);
  assert.equal(Number((await db.query("select count(*) n from public.workspace_activity where event_type='finance.payout_agreed' and actor_id=$1", [users[ACCOUNTS]])).rows[0].n), 3);

  // The same request again changes nothing and returns the same answer.
  await as(ACCOUNTS);
  const requestId = crypto.randomUUID();
  const input = financeActionSchema.parse({ action: 'agreePayouts', requestId, note: NOTE, includeDifferent: true, items: [{ reservationId: after['Bulk stay 3'].reservationId, version: after['Bulk stay 3'].version }] });
  const once = await rpc('workspace_finance_action', [input]);
  const twice = await rpc('workspace_finance_action', [input]);
  assert.deepEqual(twice, once);
  assert.equal(live.bulkApprovalSchema.parse(once).atReceived, 1);
  const three = (await rows()).find(r => r.reference === 'Bulk stay 3');
  assert.equal(three.state, 'agreed'); assert.equal(three.agreedMinor, 35000);
  assert.match(three.agreementNote, /Approved at the amount received\.$/);
  await assert.rejects(rpc('workspace_finance_action', [{ ...input, note: 'A different note for the same request' }]), /Request identifier reused/);
  await as(SUPER);
  assert.equal(Number((await db.query("select count(*) n from public.workspace_activity where event_type='finance.payout_agreed' and actor_id=$1", [users[ACCOUNTS]])).rows[0].n), 4);
});

test('a stay changed since the screen loaded is skipped, and an approval is only valid for the amount it was made against', async () => {
  await as(ACCOUNTS);
  const five = await byRef('Bulk stay 5');
  assert.equal(live.payoutMove(five), 'details');
  // Someone adds the expected payout after the screen loaded: the old version is skipped, the new one approves.
  await write({ action: 'setReservationFinancials', propertyId: five.propertyId, reservationId: five.reservationId, version: five.version, channel: 'airbnb', channelReference: 'HMBULK0005', guests: 2, payoutMinor: 15000 });
  const stale = live.bulkApprovalSchema.parse(await bulk([five]));
  assert.equal(stale.approved, 0); assert.equal(stale.skipped.changed, 1);
  const fresh = await byRef('Bulk stay 5');
  assert.equal(live.payoutMove(fresh), 'approve');
  const done = live.bulkApprovalSchema.parse(await bulk([fresh]));
  assert.equal(done.approved, 1); assert.equal(done.approvedMinor, 15000);

  // A payout that then arrives for a different amount breaks the agreement, so the stay needs approving again.
  const csv = 'Date,Type,Confirmation Code,Guest,Amount,Paid Out\n10/02/2026,Reservation,HMBULK0005,Guest E,140.00,';
  await write({ action: 'importPayoutReport', channel: 'airbnb', fileName: 'airbnb-2.csv', csv });
  const again = await byRef('Bulk stay 5');
  assert.equal(again.state, 'different'); assert.equal(again.receivedMinor, 14000);
  assert.equal(live.bulkApprovalSchema.parse(await bulk([again])).skipped.different, 1);
});

test('who can approve, and what the request must look like', async () => {
  await as(ACCOUNTS);
  const target = await byRef('Bulk stay 2');
  const item = { reservationId: target.reservationId, version: target.version };
  for (const person of [STAYS]) {
    await as(person);
    await assert.rejects(rpc('workspace_finance_action', [financeActionSchema.parse({ action: 'agreePayouts', requestId: crypto.randomUUID(), note: NOTE, items: [item] })]), /Accounts access required/);
  }
  await as(ADMIN);
  assert.equal(live.bulkApprovalSchema.parse(await write({ action: 'agreePayouts', note: NOTE, items: [item] })).skipped.settled, 1);

  // The HTTP schema refuses an empty list, too many stays, a short note and stray fields.
  const base = { action: 'agreePayouts', requestId: crypto.randomUUID(), note: NOTE, items: [item] };
  assert.equal(financeActionSchema.safeParse(base).success, true);
  assert.equal(financeActionSchema.safeParse({ ...base, items: [] }).success, false);
  assert.equal(financeActionSchema.safeParse({ ...base, items: Array.from({ length: BULK_PAYOUT_LIMIT + 1 }, () => item) }).success, false);
  assert.equal(financeActionSchema.safeParse({ ...base, note: 'ok' }).success, false);
  assert.equal(financeActionSchema.safeParse({ ...base, items: [{ ...item, agreedMinor: 1 }] }).success, false);
  assert.equal(financeActionSchema.safeParse({ ...base, agreedMinor: 1 }).success, false);
  // The database refuses the same things when called directly.
  await as(ACCOUNTS);
  const direct = extra => rpc('workspace_finance_action', [{ action: 'agreePayouts', requestId: crypto.randomUUID(), note: NOTE, items: [item], ...extra }]);
  await assert.rejects(direct({ items: [] }), /Choose between 1 and 500 stays/);
  await assert.rejects(direct({ items: [{ ...item, agreedMinor: 1 }] }), /Invalid stay in the list/);
  await assert.rejects(direct({ items: [{ reservationId: 'not-an-id', version: 1 }] }), /Invalid stay in the list/);
  await assert.rejects(direct({ agreedMinor: 1 }), /Unknown or oversized workflow input/);
  await assert.rejects(direct({ note: 'ok' }), /Invalid field note/);
  await assert.rejects(direct({ includeDifferent: 'yes' }), /Invalid field includeDifferent/);
  // A stay that does not exist is counted, not fatal.
  const missing = live.bulkApprovalSchema.parse(await direct({ items: [{ reservationId: crypto.randomUUID(), version: 1 }] }));
  assert.equal(missing.approved, 0); assert.equal(missing.skipped.notFound, 1);
});

test('a Vrbo report, then an overlapping download, through the upload: lines already held are not counted twice', async () => {
  await as(STAYS);
  const checkIn = await plusDays(month.first, 20);
  await rpc('workspace_operations_action', [operationsActionSchema.parse({ action: 'recordReservation', requestId: crypto.randomUUID(), propertyId: property, reference: 'Vrbo stay', checkIn, checkOut: await plusDays(checkIn, 3), status: 'confirmed' })]);
  await as(ACCOUNTS);
  const pending = live.reconciliationSchema.parse(await read({ section: 'reconciliation', period: month.m })).needsDetails.find(r => r.reference === 'Vrbo stay');
  const details = { action: 'setReservationFinancials', propertyId: pending.propertyId, reservationId: pending.reservationId, version: pending.version, channel: 'vrbo', guests: 2, payoutMinor: 39008 };
  assert.throws(() => write(details), /Add the platform reservation code/);
  await write({ ...details, channelReference: 'HA-E2E001' });

  const header = 'Reservation ID,Payout amount,Host service fee,Payout date,Payout ID';
  const week = await write({ action: 'importPayoutReport', channel: 'vrbo', fileName: 'vrbo-week.csv', csv: `${header}\nHA-E2E001,200.00,-10.00,05/10/2026,VR-1\n` });
  assert.equal(week.newLines, 1); assert.equal(week.alreadyHeld, 0); assert.equal(week.matchedReservations, 1);
  assert.equal((await byRef('Vrbo stay')).state, 'different');
  // The month's report repeats the week's line (written differently) and adds two more.
  const monthCsv = `\uFEFF${header}\r\n"HA-E2E001","£200","(10.00)",5/10/2026,VR-1\r\nHA-E2E001,190.08,-9.50,12/10/2026,VR-2\r\nHA-OTHER9,50.00,,12/10/2026,VR-2\r\n`;
  const whole = live.payoutImportSchema.parse(await write({ action: 'importPayoutReport', channel: 'vrbo', fileName: 'vrbo-month.csv', csv: monthCsv }));
  assert.equal(whole.lineCount, 3); assert.equal(whole.newLines, 2); assert.equal(whole.alreadyHeld, 1); assert.equal(whole.newMinor, 24008);
  assert.equal(whole.unexpectedLines, 1);
  const row = await byRef('Vrbo stay');
  assert.equal(row.state, 'matched'); assert.equal(row.receivedMinor, 39008);
  assert.equal(row.lineCount, 2); assert.equal(row.otaFeesMinor, 1950); assert.equal(row.grossMinor, 40958); assert.equal(row.fundsReceived, true);
  assert.equal(live.payoutStateLabel(row)[0], 'Matched');
  await assert.rejects(write({ action: 'importPayoutReport', channel: 'vrbo', fileName: 'again.csv', csv: monthCsv }), /already been uploaded/);
  // The payout lines report lists the stay's two lines, with their fees and dates.
  const report = live.payoutLinesReportSchema.parse(await rpc('workspace_finance_report', ['payoutLines', property, null, null, null, { channel: 'vrbo' }]));
  assert.deepEqual(report.lines.map(l => [l.reference, l.amountMinor, l.hostFeeMinor ?? l.commissionMinor, l.paidOn]).sort(), [['HA-E2E001', 19008, 950, '2026-10-12'], ['HA-E2E001', 20000, 1000, '2026-10-05']]);
});

test('a long list is one request, and counts as one change against the 60 a minute limit', async () => {
  const COUNT = 150;
  // Seeded directly as the database owner (no signed-in person), in the same month as the stays above.
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.query(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    select $1,'Busy '||g,$2::date+(g%25),$2::date+(g%25)+1,'confirmed','hostaway','airbnb','HMBUSY'||lpad(g::text,4,'0'),10000 from generate_series(1,$3) g`, [property, month.first, COUNT]);
  await as(ACCOUNTS);
  const list = (await rows()).filter(r => r.reference.startsWith('Busy '));
  assert.equal(list.length, COUNT);
  const result = live.bulkApprovalSchema.parse(await bulk(list));
  assert.equal(result.approved, COUNT); assert.equal(result.approvedMinor, COUNT * 10000); assert.equal(result.atExpected, COUNT);
  assert.equal((await rows()).filter(r => r.reference.startsWith('Busy ') && r.state === 'agreed').length, COUNT);
  await db.exec('reset role');
  const used = Number((await db.query('select writes from private.workspace_write_limits where user_id=$1', [users[ACCOUNTS]])).rows[0].writes);
  assert.ok(used < 10, `the approval counted as one change, not ${COUNT} (the limit is 60), so ${used} is the whole count`);

  // Single approvals still count one each, and the limit still bites at 60.
  await db.exec('reset role');
  await db.query("insert into private.workspace_write_limits(user_id,writes) values($1,60) on conflict(user_id) do update set writes=60,window_started_at=now()", [users[ACCOUNTS]]);
  await as(ACCOUNTS);
  const someone = (await rows())[0];
  await assert.rejects(bulk([someone]), /Too many changes/);
});
