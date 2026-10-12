import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { airbnbYear, money, render } from './payout-real-shape-fixture.mjs';

// A payout report the size and shape of a real Airbnb year (about 2,100 coded lines over about 150 payout dates, with
// the bank transfer rows), made up from a seed. It must pass every size limit on the way in, be read line for line,
// and have each date's lines add up to its bank transfers. The finance route is loaded with its sign-in and quota
// helpers replaced, as in tests/finance-teams-http.test.mjs.
const state = {}; globalThis.__realShapeHttp = state;
const mocks = {
  'business-server': `const s=globalThis.__realShapeHttp; export const businessContext=async()=>s.session;
  export const businessResponse=(body,status=200)=>Response.json(body,{status});
  export const databaseFailure=()=>Response.json({error:'Denied by database'},{status:400}); export const viewAsFailure=()=>null;`,
  'auth-security': `export const authSecurityConfiguration=()=>({origin:'https://recharge.example'}); export const requestQuota=async()=>({allowed:true,retryAfter:0});`,
};
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error', plugins: [{
  name: 'isolated-real-shape-http', enforce: 'pre',
  transform(code, id) {
    if (!/\/workspace-rpc-route\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from './${name}'`, `from 'real-shape-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('real-shape-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0real-shape-test:') ? mocks[id.slice(17)] : null,
}] });
after(async () => { delete globalThis.__realShapeHttp; await vite.close(); });
const { readPayoutLines, transferSummary, fitsPayoutUpload, MAX_PAYOUT_CSV_CHARS, MAX_PAYOUT_LINES, PAYOUT_UPLOAD_BODY_LIMIT } = await vite.ssrLoadModule('/lib/payout-reconciliation.ts');
const { workspaceFinance } = await vite.ssrLoadModule('/lib/workspace-finance-server.ts');
const { financeActionSchema, prepareFinanceAction, financeBodyLimit, FINANCE_BODY_LIMIT } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const uuid = '11111111-1111-4111-8111-111111111111';
const action = (csv, fileName = 'airbnb-year.csv') => ({ action: 'importPayoutReport', requestId: uuid, channel: 'airbnb', fileName, csv });

const year = airbnbYear();
const csv = render(year.rows);
const PAID_OUT = 14;

test('the made-up year has the size and shape of the real export', () => {
  assert.ok(csv.startsWith('﻿Date,Arriving by date,Type,Confirmation Code,'), 'BOM and the Airbnb header');
  assert.ok(csv.length > 300_000 && csv.length < 600_000, `about the real file's 406,000 characters (${csv.length})`);
  assert.ok(year.coded.length >= 1900 && year.coded.length <= 2300, `about 2,100 coded lines (${year.coded.length})`);
  assert.equal(year.days.length, 150);
  assert.ok(year.transfers.length >= 250 && year.transfers.length <= 350, `about two transfers a day (${year.transfers.length})`);
  const types = new Set(year.coded.map(line => line.type));
  for (const type of ['Reservation', 'Resolution Payout', 'Cancellation Fee', 'Cancellation Fee Refund', 'Adjustment', 'Resolution Adjustment']) assert.ok(types.has(type), type);
  assert.ok(year.coded.some(line => line.type === 'Adjustment' && line.minor < 0) && year.coded.some(line => line.type === 'Resolution Adjustment' && line.minor < 0), 'negative adjustments');
  assert.ok(/\n\d\d\/\d\d\/2026,/.test(csv) && /\n0[2-9]\/(1[3-9]|2\d|3[01])\/2026,/.test(csv), 'dates are written month first');
  assert.ok(csv.includes('"Transfer to Account ****4321, GBP"') && /"\d,\d{3}\.\d\d"/.test(csv), 'quoted fields with commas, thousands included');
  assert.ok(year.coded.every(line => /^HM[A-Z0-9]{8}$/.test(line.code)));
  for (const day of year.days) assert.equal(day.paidOutMinor, day.linesMinor, `${day.date} pays out its lines`);
  assert.equal(render(airbnbYear().rows), csv, 'the same seed gives the same file');
});

test('a year of a larger portfolio passes every size limit', () => {
  assert.equal(MAX_PAYOUT_CSV_CHARS, 2_000_000); assert.equal(MAX_PAYOUT_LINES, 8000); assert.equal(PAYOUT_UPLOAD_BODY_LIMIT, 2_600_000);
  assert.ok(financeActionSchema.safeParse(action(csv)).success);
  assert.ok(financeActionSchema.safeParse(action('x'.repeat(MAX_PAYOUT_CSV_CHARS))).success);
  const big = financeActionSchema.safeParse(action('x'.repeat(MAX_PAYOUT_CSV_CHARS + 1)));
  assert.equal(big.success, false); assert.match(big.error.issues[0].message, /too large/);
  assert.ok(fitsPayoutUpload(csv));
  assert.ok(fitsPayoutUpload('a,b\n'.repeat(MAX_PAYOUT_CSV_CHARS / 4)), 'two million plain characters fit the request body');
  assert.equal(fitsPayoutUpload('x'.repeat(MAX_PAYOUT_CSV_CHARS + 1)), false);
  assert.equal(fitsPayoutUpload('"'.repeat(1_400_000)), false, 'each quote takes two bytes as JSON');
  assert.equal(fitsPayoutUpload('é'.repeat(1_300_001)), false, 'an accented letter takes two bytes');
  assert.ok(fitsPayoutUpload('é'.repeat(1_200_000)));
  // The finance route reads up to 2,600,000 bytes for the finance roles; everyone else keeps 300,000.
  for (const role of ['accounts', 'admin', 'super_admin']) assert.equal(financeBodyLimit({ role }), PAYOUT_UPLOAD_BODY_LIMIT, role);
  for (const role of ['stays', 'cleans', 'client', 'maintenance', '', undefined]) assert.equal(financeBodyLimit({ role }), FINANCE_BODY_LIMIT, String(role));
  assert.equal(FINANCE_BODY_LIMIT, 300_000);
});

test('every coded line is read once with its own key, and every transfer row is skipped', () => {
  const report = readPayoutLines(csv, 'airbnb');
  assert.equal(report.error, undefined);
  assert.equal(report.lines.length, year.coded.length);
  assert.deepEqual(report.skipped, { noCode: year.transfers.length, noAmount: 0 });
  assert.deepEqual(report.lines.map(line => [line.reference, line.amountMinor, line.lineType]), year.coded.map(line => [line.code, line.minor, line.type]));
  const keys = report.lines.map(line => line.key);
  assert.ok(keys.every(Boolean)); assert.equal(new Set(keys).size, keys.length, 'no two lines share a key');
  assert.deepEqual(report.lines.map(line => line.paidOn), year.coded.map(line => line.date), 'paidOn is the payout date, read month first');
  assert.equal(report.used.net, 'Amount, Paid out'); assert.equal(report.used.payoutRef, 'Reference code');
  const prepared = prepareFinanceAction(action(csv));
  assert.equal(prepared.input.lines.length, year.coded.length);
  assert.equal(Object.hasOwn(prepared.input, 'transfers'), false, 'the transfer check stays on the screen, not in the database payload');
});

test('every payout date adds up to its bank transfers', () => {
  const { transfers } = readPayoutLines(csv, 'airbnb');
  assert.deepEqual(transfers, { checked: year.days.length, matched: year.days.length, mismatches: [], linesWithoutTransfer: 0 });
  assert.deepEqual(transferSummary(transfers), { text: 'All 150 payout dates add up to the bank transfers.', details: [], allMatched: true });
});

test('one altered transfer is one mismatch, with the difference, and never stops the upload', () => {
  const k = 37, altered = year.rows.map(row => row === year.transfers[k].row ? Object.assign([...row], { [PAID_OUT]: money(year.transfers[k].minor + 1234) }) : row);
  assert.equal(altered.filter((row, i) => row !== year.rows[i]).length, 1);
  const before = readPayoutLines(csv, 'airbnb'), report = readPayoutLines(render(altered), 'airbnb');
  const day = year.days.find(d => d.date === year.transfers[k].date);
  assert.deepEqual(report.transfers.mismatches, [{ date: day.date, paidOutMinor: day.paidOutMinor + 1234, linesMinor: day.linesMinor }]);
  assert.equal(report.transfers.checked, 150); assert.equal(report.transfers.matched, 149);
  assert.deepEqual(report.lines, before.lines, 'the lines and their keys are unchanged');
  const words = transferSummary(report.transfers);
  assert.equal(words.text, '1 of 150 payout dates does not add up to the bank transfer.'); assert.equal(words.allMatched, false);
  assert.equal(words.details.length, 1); assert.match(words.details[0], /^\d{1,2} [A-Z][a-z]{2} 2026: transfer £[\d,]+\.\d\d, lines £[\d,]+\.\d\d, difference £12\.34$/);
  assert.ok(!('error' in prepareFinanceAction(action(render(altered)))), 'a difference only informs');
});

test('several mismatches list the first few; lines with no transfer yet are counted', () => {
  const picks = [3, 40, 81, 120, 160].map(i => year.transfers[i]);
  const altered = year.rows.map(row => { const t = picks.find(p => p.row === row); return t ? Object.assign([...row], { [PAID_OUT]: money(t.minor - 500) }) : row; });
  const mismatchDays = new Set(picks.map(p => p.date));
  const report = readPayoutLines(render(altered), 'airbnb');
  assert.equal(report.transfers.mismatches.length, mismatchDays.size);
  assert.ok(report.transfers.mismatches.every(m => m.paidOutMinor - m.linesMinor < 0));
  assert.deepEqual(report.transfers.mismatches.map(m => m.date), [...mismatchDays].sort(), 'oldest first');
  const words = transferSummary(report.transfers, 3);
  assert.equal(words.text, `${mismatchDays.size} of 150 payout dates do not add up to the bank transfer.`);
  assert.equal(words.details.length, 4); assert.equal(words.details[3], `And ${mismatchDays.size - 3} payout date${mismatchDays.size - 3 === 1 ? '' : 's'} more.`);
  // The newest day's money has not reached the bank yet: its transfer rows are not in the file.
  const newest = year.days[0], unpaid = new Set(year.transfers.filter(t => t.date === newest.date).map(t => t.row));
  const pending = readPayoutLines(render(year.rows.filter(row => !unpaid.has(row))), 'airbnb');
  const count = year.coded.filter(line => line.date === newest.date).length;
  assert.deepEqual([pending.transfers.checked, pending.transfers.matched, pending.transfers.linesWithoutTransfer], [149, 149, count]);
  assert.equal(pending.lines.length, year.coded.length);
  assert.deepEqual(transferSummary(pending.transfers).details, [`${count} lines have no bank transfer in this file yet.`]);
});

test('files without transfer rows have no transfer check', () => {
  const noTransfers = render(year.rows.filter(row => row[2] !== 'Payout'));
  assert.equal(readPayoutLines(noTransfers, 'airbnb').transfers, null);
  assert.equal(readPayoutLines('Reservation number,Net,Payout date\n4172839560,520.00,14/10/2026\n', 'booking_com').transfers, null);
  assert.equal(readPayoutLines('Reservation ID,Payout amount,Payout date\nHA-1,390.08,16/11/2026\n', 'vrbo').transfers, null);
  assert.equal(readPayoutLines('Guest,Amount\nA,10.00\n', 'airbnb').transfers, null, 'a refused file');
  assert.equal(transferSummary(null), null);
  const one = readPayoutLines('Date,Type,Confirmation code,Amount,Paid out\n10/01/2026,Payout,,,"1,000.00"\n10/01/2026,Reservation,HMQ4K2T8XW,"1,000.00",\n', 'airbnb');
  assert.deepEqual(one.transfers, { checked: 1, matched: 1, mismatches: [], linesWithoutTransfer: 0 });
  assert.equal(transferSummary(one.transfers).text, 'The 1 payout date adds up to the bank transfer.');
});

// The finance route, end to end up to the database call: who may send a large report, and how large.
function session(role) {
  Object.assign(state, { calls: [], session: { account: { userId: uuid, status: 'active', role }, client: { rpc: async (name, args) => { state.calls.push({ name, args }); return { data: { ok: 1 }, error: null }; } } } });
}
const post = body => new Request('https://recharge.example/api/workspace/finance', { method: 'POST', headers: { origin: 'https://recharge.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('the finance route takes a large report from the finance roles only', async () => {
  session('accounts');
  assert.equal((await workspaceFinance(post(action(csv)))).status, 200);
  assert.equal(state.calls[0].args.input.lines.length, year.coded.length);
  // About four years of the same portfolio, still under 8,000 lines.
  const larger = render(airbnbYear({ seed: 7, days: 500, linesPerDay: 15 }).rows), lines = readPayoutLines(larger, 'airbnb').lines.length;
  assert.ok(lines > 7000 && lines <= MAX_PAYOUT_LINES && larger.length < MAX_PAYOUT_CSV_CHARS, `${lines} lines, ${larger.length} characters`);
  session('admin');
  assert.equal((await workspaceFinance(post(action(larger)))).status, 200);
  assert.equal(state.calls[0].args.input.lines.length, lines);
  // Past 8,000 lines the report is turned away with a reason, before the database.
  const tooMany = render(airbnbYear({ seed: 8, days: 600, linesPerDay: 15 }).rows);
  session('accounts');
  const refused = await workspaceFinance(post(action(tooMany)));
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /more than 8,000 payout lines/); assert.equal(state.calls.length, 0);
  // Anyone else keeps the old 300,000 byte limit, so a body this size is never read for them.
  for (const role of ['stays', 'cleans', 'client']) {
    session(role);
    assert.equal((await workspaceFinance(post(action(csv)))).status, 400, role); assert.equal(state.calls.length, 0);
  }
  // And nobody's body is read past 2,600,000 bytes: a file of quotes (two bytes each as JSON) just under it is read
  // (and refused by the reader), one just over it is not read at all.
  session('super_admin');
  const under = await workspaceFinance(post(action('"'.repeat(1_290_000))));
  assert.equal(under.status, 400); assert.match((await under.json()).error, /no data rows/);
  const over = await workspaceFinance(post(action('"'.repeat(1_310_000))));
  assert.equal(over.status, 400); assert.doesNotMatch((await over.json()).error, /no data rows/); assert.equal(state.calls.length, 0);
});

test('the upload screen checks the same limits and shows the transfer check after a successful upload', () => {
  const screen = readFileSync(new URL('../mobile/src/LiveAccounts.tsx', import.meta.url), 'utf8');
  const upload = screen.slice(screen.indexOf('async function upload('), screen.indexOf('async function statementAction('));
  assert.match(upload, /if \(!fitsPayoutUpload\(file\.text\)\) \{ setUploadNote\(TOO_LARGE\); return; \}/);
  assert.match(upload, /read\.lines\.length > MAX_PAYOUT_LINES/);
  assert.ok(upload.indexOf('transferSummary(read.transfers)') > upload.indexOf('importPayoutReport'), 'shown once the server has taken the file');
  assert.doesNotMatch(upload, /read\.transfers[^)]*\) *\{ *setUploadNote/, 'a difference never stops the upload');
  assert.match(screen, /<TransferCheck p=\{p\} words=\{uploadResult\.transfers\} \/>/);
  assert.match(screen, /<HowRead p=\{p\} used=\{uploadResult\.used\} transfers=\{uploadResult\.transfers\} \/>/);
  assert.doesNotMatch(screen, /250000/);
  const client = readFileSync(new URL('../mobile/src/backend/client.ts', import.meta.url), 'utf8');
  assert.match(client, /\.action === "importPayoutReport"\);/, 'a payout report gets the longer request timeout');
});

// The real export, when its path is given (it holds guest names, so it is never copied into the repository).
const REAL = process.env.RECHARGE_REAL_AIRBNB_CSV;
if (REAL && existsSync(REAL)) test('the real Airbnb export: 2,066 lines, 312 transfer rows, 155 payout dates all matched', () => {
  const real = readFileSync(REAL, 'utf8'), report = readPayoutLines(real, 'airbnb');
  assert.equal(report.error, undefined);
  assert.equal(report.lines.length, 2066);
  assert.deepEqual(report.skipped, { noCode: 312, noAmount: 0 });
  const keys = report.lines.map(line => line.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(report.transfers, { checked: 155, matched: 155, mismatches: [], linesWithoutTransfer: 0 });
  assert.ok(financeActionSchema.safeParse(action(real)).success);
  assert.ok(fitsPayoutUpload(real));
  assert.equal(prepareFinanceAction(action(real)).input.lines.length, 2066);
});
