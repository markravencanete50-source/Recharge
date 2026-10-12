import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Reconciliation version 2 (20261012080000): VRBO joins Airbnb and Booking.com, payout reports are
// held line by line (an overlapping report adds only what is new), a line can be set aside with a
// reason, and old-shape uploads (reference and amount only) keep today's rules. Requests are sent
// straight to the database in the shape the upload screen sends: { channel, fileName, lines }.
const MIGRATION = 'supabase/migrations/20261012080000_reconciliation_vrbo.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['super_admin', 'admin', 'accounts', 'stays', 'client'];
const users = roles.map((_, i) => `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, ACCOUNTS, STAYS, OWNER] = [0, 1, 2, 3, 4];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `recon${i}@example.com`]);
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
// Trusted set-up writes and checks, as the database itself.
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const finance = input => rpc('workspace_finance_action', [{ requestId: crypto.randomUUID(), ...input }]);
const reconciliation = (propertyId = null) => rpc('workspace_finance_read', ['reconciliation', propertyId, '2026-09', null, null]);
const report = (section, { propertyId = null, id = null, from = null, to = null, filters = null } = {}) => rpc('workspace_finance_report', [section, propertyId, id, from, to, filters]);
const upload = (channel, lines, fileName = `${channel}-${crypto.randomUUID().slice(0, 8)}.csv`) => finance({ action: 'importPayoutReport', channel, fileName, lines });
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };

// A payout line as the upload screen builds it. The key is the code, date, type, amount, payout reference and occurrence.
const line = (channel, reference, amountMinor, { gross = null, commission = null, hostFee = null, paymentFee = null, cleaningFee = null, paidOn = '2026-09-10', type = 'Reservation', payoutRef = 'PO-1', occurrence = 1, keyed = true } = {}) => ({
  reference, amountMinor, grossMinor: gross, commissionMinor: commission, hostFeeMinor: hostFee, paymentFeeMinor: paymentFee, cleaningFeeMinor: cleaningFee,
  paidOn, lineType: type, key: keyed ? [channel, reference.toUpperCase(), paidOn, type, amountMinor, payoutRef, occurrence].join('|') : null,
});

await as(SUPER);
const HOME = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Reconciliation flat' }]);
const LOCKED = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Issued statement cottage' }]);
await rpc('workspace_assign_property', [HOME, users[OWNER], 'client']);
await rpc('workspace_assign_property', [HOME, users[STAYS], 'staff']);

await asDb();
const stays = {};
async function stay(key, prop, channel, code, checkIn, checkOut, payout, status = 'confirmed') {
  const { rows } = await db.query(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,payout_minor)
    values($1,$2,$3,$4,$5,'hostaway',$6,$7,$8) returning id`, [prop, `Stay ${key}`, checkIn, checkOut, status, channel, code, payout]);
  stays[key] = rows[0].id;
}
await stay('V1', HOME, 'vrbo', 'HA-1001', '2026-09-01', '2026-09-04', 42400);
await stay('V2', HOME, 'vrbo', 'HA-1002', '2026-09-05', '2026-09-07', 30000);
await stay('V3', HOME, 'vrbo', 'HA-1003', '2026-09-08', '2026-09-10', 25000);
await stay('VC', HOME, 'vrbo', 'HA-9000', '2026-09-11', '2026-09-13', 20000, 'cancelled');
await stay('A1', HOME, 'airbnb', 'HMADJ0001', '2026-09-14', '2026-09-16', 50000);
await stay('A2', HOME, 'airbnb', 'HMDUP0001', '2026-09-17', '2026-09-19', 30000);
await stay('O1', HOME, 'airbnb', 'HMOLD0001', '2026-09-20', '2026-09-22', 44500);
await stay('NC', HOME, 'vrbo', null, '2026-09-23', '2026-09-25', 18000);
await stay('LK', LOCKED, 'vrbo', 'HA-LOCK1', '2026-08-03', '2026-08-06', 40000);
await db.query(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,issued_at)
  values($1,'2026-08-01','issued',40000,0,0,0,1500,6000,34000,'{"stays":[],"expenses":[]}'::jsonb,$2,now())`, [LOCKED, users[ADMIN]]);

const rowOf = async key => { await as(ACCOUNTS); return (await reconciliation()).rows.find(r => r.reservationId === stays[key]); };
const linesFor = async code => sql('select * from private.workspace_payout_lines where upper(reference)=upper($1) order by amount_minor,id', [code]);

test('a VRBO payout matches its stay, with its gross and fees', async () => {
  await as(ACCOUNTS);
  const nc = (await sql('select version from private.workspace_reservations where id=$1', [stays.NC]))[0];
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'setReservationFinancials', propertyId: HOME, reservationId: stays.NC, version: nc.version, channel: 'vrbo', guests: 2, payoutMinor: 18000 }), /Platform reservation code required/);

  const result = await upload('vrbo', [line('vrbo', 'HA-1001', 42400, { gross: 45792, hostFee: 3392, paidOn: '2026-09-04' })], 'vrbo-september.csv');
  assert.equal(result.channel, 'vrbo');
  assert.deepEqual([result.lineCount, result.totalMinor, result.newLines, result.newMinor, result.alreadyHeld, result.cancelledStay, result.matchedReservations, result.unexpectedLines], [1, 42400, 1, 42400, 0, 0, 1, 0]);

  const rec = await reconciliation();
  const v1 = rec.rows.find(r => r.reservationId === stays.V1);
  assert.equal(v1.channel, 'vrbo'); assert.equal(v1.state, 'matched'); assert.equal(v1.settledMinor, 42400);
  assert.deepEqual([v1.lineCount, v1.fundsReceived, v1.agreedBeforeFunds, v1.repeatedAmount, v1.otaFeesMinor, v1.grossMinor], [1, true, false, null, 3392, 45792]);
  assert.equal(rec.rows.find(r => r.reservationId === stays.V2).state, 'missing', 'a VRBO stay with no payout yet is waiting for one');
  assert.equal(rec.rows.find(r => r.reservationId === stays.NC).state, 'no_reference', 'a VRBO stay without its code is reconciled, not treated as direct');
  assert.ok(!rec.needsDetails.some(r => r.channel === 'vrbo'), 'VRBO stays are no longer listed as missing details');
  assert.equal(rec.reports[0].channel, 'vrbo'); assert.equal(rec.reports[0].newLineCount, 1); assert.equal(rec.reports[0].newMinor, 42400);
  const [held] = await linesFor('HA-1001');
  assert.deepEqual([held.channel, held.gross_minor, held.host_fee_minor, held.commission_minor, held.line_type, held.paid_on.toISOString().slice(0, 10)], ['vrbo', 45792, 3392, null, 'Reservation', '2026-09-04']);
});

test('an overlapping report adds only the new lines and leaves the totals already held unchanged', async () => {
  await as(ACCOUNTS);
  const overlap = [line('vrbo', 'HA-1001', 42400, { gross: 45792, hostFee: 3392, paidOn: '2026-09-04' }), line('vrbo', 'HA-1002', 30000, { gross: 32400, hostFee: 2400, paidOn: '2026-09-07' })];
  const result = await upload('vrbo', overlap, 'vrbo-overlap.csv');
  assert.deepEqual([result.lineCount, result.totalMinor, result.newLines, result.newMinor, result.alreadyHeld, result.matchedReservations], [2, 72400, 1, 30000, 1, 1]);
  assert.equal((await linesFor('HA-1001')).length, 1, 'the line already held is not stored twice');
  const v1 = await rowOf('V1');
  assert.equal(v1.receivedMinor, 42400); assert.equal(v1.state, 'matched'); assert.equal(v1.lineCount, 1);
  assert.equal((await rowOf('V2')).state, 'matched');

  // The same lines in another order are a different file, but every line is already held.
  await as(ACCOUNTS);
  const reordered = await upload('vrbo', [...overlap].reverse(), 'vrbo-overlap-sorted.csv');
  assert.deepEqual([reordered.newLines, reordered.newMinor, reordered.alreadyHeld], [0, 0, 2]);
  assert.equal((await rowOf('V1')).receivedMinor, 42400); assert.equal((await rowOf('V2')).receivedMinor, 30000);
});

test('a byte-identical file is refused', async () => {
  await as(ACCOUNTS);
  const before = (await sql('select count(*)::int n from private.workspace_payout_reports'))[0].n;
  await as(ACCOUNTS);
  const same = [line('vrbo', 'HA-1001', 42400, { gross: 45792, hostFee: 3392, paidOn: '2026-09-04' }), line('vrbo', 'HA-1002', 30000, { gross: 32400, hostFee: 2400, paidOn: '2026-09-07' })];
  await assert.rejects(upload('vrbo', same, 'vrbo-overlap-again.csv'), /already been uploaded/);
  assert.equal((await sql('select count(*)::int n from private.workspace_payout_reports'))[0].n, before);
  // Lines without a key (the report had no date or reference) are never de-duplicated: only the identical file is refused.
  await as(ACCOUNTS);
  const unkeyed = [line('vrbo', 'HA-0001', 100, { keyed: false, paidOn: null })];
  assert.equal((await upload('vrbo', unkeyed)).newLines, 1);
  await as(ACCOUNTS);
  await assert.rejects(upload('vrbo', unkeyed), /already been uploaded/);
});

test('an adjustment line adds to the stay total', async () => {
  await as(ACCOUNTS);
  const result = await upload('airbnb', [
    line('airbnb', 'HMADJ0001', 48000, { gross: 49485, hostFee: 1485, paidOn: '2026-09-15' }),
    line('airbnb', 'HMADJ0001', 2000, { type: 'Adjustment', paidOn: '2026-09-20', payoutRef: 'PO-2' }),
  ]);
  assert.deepEqual([result.newLines, result.newMinor, result.matchedReservations], [2, 50000, 1], 'one stay, two lines');
  const a1 = await rowOf('A1');
  assert.deepEqual([a1.state, a1.receivedMinor, a1.settledMinor, a1.lineCount, a1.otaFeesMinor, a1.grossMinor], ['matched', 50000, 50000, 2, 1485, 51485]);
});

test('the same amount twice is different with a repeated amount hint, and setting one aside matches it', async () => {
  await as(ACCOUNTS);
  const first = line('airbnb', 'HMDUP0001', 30000, { paidOn: '2026-09-19', payoutRef: 'PO-7' });
  const second = line('airbnb', 'HMDUP0001', 30000, { paidOn: '2026-09-26', payoutRef: 'PO-8' });
  await upload('airbnb', [first, second]);
  let a2 = await rowOf('A2');
  assert.deepEqual([a2.state, a2.receivedMinor, a2.repeatedAmount, a2.lineCount], ['different', 60000, 30000, 2]);

  await as(ACCOUNTS);
  const listed = await report('payoutLines', { id: stays.A2 });
  assert.equal(listed.section, 'payoutLines'); assert.equal(listed.count, 2); assert.equal(listed.activeMinor, 60000);
  assert.ok(listed.lines.every(l => l.reservationId === stays.A2 && l.stayStatus === 'confirmed' && l.canSetAside && l.keyed));
  const late = listed.lines.find(l => l.paidOn === '2026-09-26');
  await assert.rejects(finance({ action: 'setAsidePayoutLine', lineId: late.lineId, note: 'no' }), /Invalid field note/);
  const aside = await finance({ action: 'setAsidePayoutLine', lineId: late.lineId, note: 'Paid twice: the same payout in two overlapping reports' });
  assert.equal(aside.lineId, late.lineId); assert.equal(aside.reservationId, stays.A2);
  assert.equal(aside.payout.state, 'matched'); assert.equal(aside.payout.repeatedAmount, null); assert.equal(aside.payout.lineCount, 1);
  a2 = await rowOf('A2');
  assert.deepEqual([a2.state, a2.receivedMinor, a2.settledMinor], ['matched', 30000, 30000]);
  await as(ACCOUNTS);
  await assert.rejects(finance({ action: 'setAsidePayoutLine', lineId: late.lineId, note: 'Setting it aside again' }), /already been set aside/);
  await assert.rejects(finance({ action: 'setAsidePayoutLine', lineId: crypto.randomUUID(), note: 'A line that does not exist' }), /Payout line not found/);
  const setAside = await report('payoutLines', { id: stays.A2, filters: { state: 'setAside' } });
  assert.equal(setAside.count, 1); assert.equal(setAside.lines[0].setAsideBy, 'Person 2'); assert.match(setAside.lines[0].setAsideNote, /Paid twice/);
  // The set-aside line in a later report is still held: it does not come back.
  const again = await upload('airbnb', [second]);
  assert.deepEqual([again.newLines, again.alreadyHeld], [0, 1]);
  assert.equal((await rowOf('A2')).state, 'matched');
});

test('a line for a cancelled stay is listed as having no confirmed stay, tagged cancelled', async () => {
  await as(ACCOUNTS);
  const result = await upload('vrbo', [line('vrbo', 'HA-9000', 20000, { paidOn: '2026-09-12' }), line('vrbo', 'HA-0000', 5000, { paidOn: '2026-09-12' })]);
  assert.deepEqual([result.newLines, result.cancelledStay, result.matchedReservations, result.unexpectedLines], [2, 1, 0, 2]);
  const rec = await reconciliation();
  const cancelled = rec.unexpected.find(u => u.reference === 'HA-9000');
  assert.equal(cancelled.stayStatus, 'cancelled'); assert.equal(cancelled.reservationId, stays.VC); assert.equal(cancelled.channel, 'vrbo');
  assert.equal(rec.unexpected.find(u => u.reference === 'HA-0000').stayStatus, null);
  assert.ok(!rec.rows.some(r => r.reservationId === stays.VC), 'a cancelled stay is not reconciled');
  await as(ACCOUNTS);
  const forHome = await reconciliation(HOME);
  assert.ok(forHome.unexpected.some(u => u.reference === 'HA-9000'), 'filtered by property, the cancelled stay is still shown');
  assert.ok(!forHome.unexpected.some(u => u.reference === 'HA-0000'), 'a line with no stay at all belongs to no property');
  const open = await report('payoutLines', { filters: { state: 'noConfirmedStay', channel: 'vrbo' } });
  assert.ok(['HA-9000', 'HA-0000'].every(code => open.lines.some(l => l.reference === code)));
  assert.ok(open.lines.every(l => l.stayStatus !== 'confirmed'));
});

test('approving twice is harmless, and an approval before the funds arrive says so', async () => {
  await as(ACCOUNTS);
  let v3 = await rowOf('V3');
  assert.equal(v3.state, 'missing');
  const note = 'Checked against the VRBO dashboard';
  const once = await finance({ action: 'agreePayouts', note, items: [{ reservationId: v3.reservationId, version: v3.version }] });
  assert.equal(once.approved, 1); assert.equal(once.approvedMinor, 25000);
  const twice = await finance({ action: 'agreePayouts', note, items: [{ reservationId: v3.reservationId, version: v3.version }] });
  assert.equal(twice.approved, 0); assert.equal(twice.skipped.settled, 1);
  await finance({ action: 'agreePayout', reservationId: v3.reservationId, version: v3.version, agreedMinor: 25000, note: 'Approved again by hand' });
  assert.equal((await sql('select count(*)::int n from private.workspace_payout_agreements where reservation_id=$1', [stays.V3]))[0].n, 1);
  v3 = await rowOf('V3');
  assert.deepEqual([v3.state, v3.settledMinor, v3.agreedBeforeFunds, v3.fundsReceived, v3.otaFeesMinor, v3.grossMinor], ['agreed', 25000, true, false, null, 25000], 'Approved, not received');
  // The funds then arrive at the expected amount: matched, and the approval no longer applies.
  await as(ACCOUNTS);
  await upload('vrbo', [line('vrbo', 'HA-1003', 25000, { paidOn: '2026-09-11' })]);
  v3 = await rowOf('V3');
  assert.deepEqual([v3.state, v3.settledMinor, v3.agreedBeforeFunds, v3.fundsReceived], ['matched', 25000, false, true]);
});

test('an old-shape upload works exactly as before', async () => {
  await as(ACCOUNTS);
  await assert.rejects(upload('airbnb', [{ reference: 'A', amountMinor: 1.5 }]), /Invalid payout line/);
  await assert.rejects(upload('airbnb', [{}]), /Invalid payout line/);
  await assert.rejects(upload('airbnb', [{ reference: 'A', amountMinor: 1 }, { reference: 'a', amountMinor: 2 }]), /Combine repeated/);
  await assert.rejects(upload('direct', [{ reference: 'A', amountMinor: 1 }]), /between 1 and 2,000/);
  // The old branches were renamed and are never reached: the access check refuses their names.
  for (const action of ['retired:importPayoutReport', 'retired:setAsidePayoutLine']) await assert.rejects(finance({ action, channel: 'airbnb', fileName: 'x.csv', lines: [] }), /Unknown finance action/);
  const lines = [{ reference: 'HMOLD0001', amountMinor: 44500 }, { reference: 'HMNOSTAY9', amountMinor: 7000 }];
  const result = await upload('airbnb', lines, 'airbnb-payouts.csv');
  assert.deepEqual([result.lineCount, result.totalMinor, result.matchedReservations, result.unexpectedLines, result.newLines, result.alreadyHeld, result.cancelledStay], [2, 51500, 1, 1, 2, 0, 0]);
  await assert.rejects(upload('airbnb', [...lines].reverse(), 'copy.csv'), /already been uploaded/);
  const stored = await sql(`select r.content_hash,r.new_line_count,l.channel,l.line_key,l.gross_minor,l.paid_on from private.workspace_payout_lines l join private.workspace_payout_reports r on r.id=l.report_id where l.reference='HMOLD0001'`);
  assert.equal(stored[0].content_hash, (await sql("select md5('HMNOSTAY9:7000,HMOLD0001:44500') h"))[0].h, 'the same file fingerprint as before');
  assert.deepEqual([stored[0].channel, stored[0].line_key, stored[0].gross_minor, stored[0].paid_on, stored[0].new_line_count], ['airbnb', null, null, null, 2]);
  assert.equal((await rowOf('O1')).state, 'matched');
  // A later old-shape line for the same code adds to it, as it always did.
  await as(ACCOUNTS);
  await upload('airbnb', [{ reference: 'HMOLD0001', amountMinor: 1500 }], 'adjustment.csv');
  const o1 = await rowOf('O1');
  assert.deepEqual([o1.state, o1.receivedMinor, o1.otaFeesMinor, o1.lineCount], ['different', 46000, null, 2]);
});

test('new-shape lines are checked before anything is stored', async () => {
  await as(ACCOUNTS);
  const ok = line('vrbo', 'HA-CHECK', 100);
  for (const [bad, reason] of [
    [{ ...ok, paidOn: '2026-02-30' }, /Invalid payout line 1/],
    [{ ...ok, grossMinor: 10.5 }, /Invalid payout line 1/],
    [{ ...ok, hostFeeMinor: '12' }, /Invalid payout line 1/],
    [{ ...ok, amountMinor: null }, /Invalid payout line 1/],
    [{ ...ok, amountMinor: 100000001 }, /Invalid payout line 1/],
    [{ ...ok, key: '' }, /Invalid payout line 1/],
    [{ ...ok, currency: 'GBP' }, /Invalid payout line 1/],
  ]) await assert.rejects(upload('vrbo', [bad]), reason);
  await assert.rejects(upload('vrbo', [ok, ok]), /repeats a payout line/);
  // Checked in one pass: the first bad line in file order is named.
  const more = n => line('vrbo', 'HA-CHECK', 100 + n);
  await assert.rejects(upload('vrbo', [more(1), more(2), { ...more(3), paidOn: '2026-13-01' }, { ...more(4), amountMinor: 'x' }]), /Invalid payout line 3$/);
  await assert.rejects(upload('vrbo', [more(1), 5, { ...more(3), paidOn: '1999-12-31' }]), /Invalid payout line 2$/);
  await assert.rejects(upload('vrbo', [more(1), { ...more(2), paidOn: '2028-02-30' }]), /Invalid payout line 2$/);
  await assert.rejects(upload('vrbo', [more(1), { ...more(2), lineType: '  ' }]), /Invalid payout line 2$/);
  // A year of a larger portfolio fits (8,000 lines); old-shape files keep their old limit of 2,000.
  await assert.rejects(upload('vrbo', Array.from({ length: 8001 }, (_, i) => line('vrbo', 'HA-MANY', i + 1))), /between 1 and 8,000/);
  await assert.rejects(upload('vrbo', Array.from({ length: 2001 }, (_, i) => ({ reference: `HA-OLD${i}`, amountMinor: 1 }))), /between 1 and 2,000/);
  await assert.rejects(upload('vrbo', []), /between 1 and 2,000/);
  await assert.rejects(upload('vrbo', 'not a list'), /between 1 and 8,000/);
  assert.equal((await linesFor('HA-CHECK')).length, 0);
});

test('a line whose stay is in an issued statement cannot be set aside', async () => {
  await as(ACCOUNTS);
  await upload('vrbo', [line('vrbo', 'HA-LOCK1', 40000, { paidOn: '2026-08-06' })]);
  const listed = await report('payoutLines', { propertyId: LOCKED });
  assert.equal(listed.count, 1); assert.equal(listed.lines[0].locked, true); assert.equal(listed.lines[0].canSetAside, false);
  await assert.rejects(finance({ action: 'setAsidePayoutLine', lineId: listed.lines[0].lineId, note: 'Trying after the statement was issued' }), /Void the issued statement/);
});

test('finance reports: dates, filters and sections that need a later update', async () => {
  await as(ACCOUNTS);
  const week = await report('payoutLines', { from: '2026-09-04', to: '2026-09-07', filters: { channel: 'vrbo' } });
  assert.deepEqual(week.lines.map(l => l.reference).sort(), ['HA-1001', 'HA-1002']);
  assert.equal(week.lines.find(l => l.reference === 'HA-1001').propertyName, 'Reconciliation flat');
  await assert.rejects(report('payoutLines', { from: '2026-09-07', to: '2026-09-04' }), /Choose a date range/);
  await assert.rejects(report('payoutLines', { filters: { owner: 'x' } }), /Invalid report filters/);
  await assert.rejects(report('payoutLines', { filters: { channel: 'direct' } }), /Invalid report filters/);
  await assert.rejects(report('payoutLines', { filters: { reportId: 'nope' } }), /Invalid report filters/);
  await assert.rejects(report('notBuiltYet'), /needs a database update/);
  await assert.rejects(report('payout-lines; drop table x'), /Unknown finance report/);
});

test('no function still lists only two platforms', async () => {
  const rows = await sql(`select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname not in ('pg_catalog','information_schema') and p.prokind in ('f','p')`);
  const twoPlatforms = /('airbnb'\s*,\s*'booking_com'|'booking_com'\s*,\s*'airbnb')\s*[)\]]/;
  assert.deepEqual(rows.filter(r => twoPlatforms.test(r.def)).map(r => r.name), []);
  for (const name of ['private.workspace_finance_action(jsonb)', 'private.workspace_finance_read(text,uuid,text,uuid,text)', 'private.workspace_agree_payouts(jsonb)',
    'private.workspace_owner_period_cell(uuid,date)', 'private.workspace_management_overview()']) {
    assert.ok(rows.find(r => r.name === name).def.includes("'booking_com','vrbo')"), name);
  }
  const check = await sql("select pg_get_constraintdef(oid) d from pg_constraint where conname='workspace_payout_reports_channel_check'");
  assert.match(check[0].d, /'vrbo'/);
  assert.equal((await sql("select count(*)::int n from pg_indexes where indexname='workspace_payout_lines_ref_idx'"))[0].n, 0);
});

test('an owner, Stays and anyone signed out get nothing', async () => {
  for (const who of [OWNER, STAYS]) {
    await as(who);
    await assert.rejects(report('payoutLines'), /Accounts access required/);
    await assert.rejects(reconciliation(), /Accounts access required/);
    await assert.rejects(upload('vrbo', [line('vrbo', 'HA-OWNER', 1)]), /Accounts access required/);
    await assert.rejects(finance({ action: 'setAsidePayoutLine', lineId: crypto.randomUUID(), note: 'Not mine to change' }), /Accounts access required/);
    await assert.rejects(db.query('select * from private.workspace_payout_lines'), /permission denied/);
    await assert.rejects(db.query('select * from private.workspace_payout_reports'), /permission denied/);
    await assert.rejects(db.query("select private.workspace_import_payout_report('{}'::jsonb)"), /permission denied/);
  }
  await as(OWNER);
  const periods = await rpc('workspace_owner_periods', ['2026-09-01', '2026-09-01']);
  const text = JSON.stringify(periods);
  for (const hidden of ['HA-1001', 'lineId', 'lineCount', 'repeatedAmount', 'Paid twice']) assert.ok(!text.includes(hidden), `owners never see ${hidden}`);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query("select public.workspace_finance_report('payoutLines')"), /permission denied/);
  await db.exec('reset role');
});

test('the migration runs twice cleanly, with the same grants and the same functions', async () => {
  const snapshot = async () => ({
    functions: await sql(`select p.oid::regprocedure::text name,coalesce(p.proacl::text,'') acl,p.prosecdef,coalesce(array_to_string(p.proconfig,','),'') config,md5(pg_get_functiondef(p.oid)) def
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.prokind='f' order by 1`),
    tables: await sql(`select c.oid::regclass::text name,coalesce(c.relacl::text,'') acl,c.relrowsecurity from pg_class c where c.oid in ('private.workspace_payout_lines'::regclass,'private.workspace_payout_reports'::regclass) order by 1`),
    constraints: await sql(`select conrelid::regclass::text t,conname,pg_get_constraintdef(oid) d from pg_constraint where conrelid in ('private.workspace_payout_lines'::regclass,'private.workspace_payout_reports'::regclass) order by 1,2`),
    indexes: await sql(`select indexname,indexdef from pg_indexes where tablename in ('workspace_payout_lines','workspace_payout_reports') order by 1`),
    data: await sql('select (select count(*)::int from private.workspace_payout_lines) lines,(select count(*)::int from private.workspace_payout_reports) reports,(select sum(amount_minor)::bigint from private.workspace_payout_lines where set_aside_at is null) active'),
  });
  const before = await snapshot();
  await asDb();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  const afterRun = await snapshot();
  assert.deepEqual(afterRun.functions, before.functions);
  assert.deepEqual(afterRun.tables, before.tables);
  assert.deepEqual(afterRun.constraints, before.constraints);
  assert.deepEqual(afterRun.indexes, before.indexes);
  assert.deepEqual(afterRun.data, before.data);
  const privateGrants = afterRun.functions.filter(f => /workspace_(import_payout_report|set_aside_payout_line|payout_row|payout_stay_locked|payout_minor_ok)\(/.test(f.name));
  assert.equal(privateGrants.length, 5);
  for (const f of privateGrants) assert.equal(f.acl, '{postgres=X/postgres}', `${f.name} is server only`);
  for (const f of afterRun.functions.filter(f => f.name.includes('workspace_finance_report('))) {
    assert.match(f.acl, /authenticated=X/); assert.doesNotMatch(f.acl, /anon=/); assert.equal(f.config, 'search_path=""');
  }
  // Still working after the second run.
  await as(ACCOUNTS);
  assert.equal((await rowOf('V1')).state, 'matched');
});
