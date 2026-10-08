import { csvCell } from './analytics-export';
import { readPayoutReport } from './payout-reconciliation';
import { statementSchema } from './accounts-live';

// Files Accounts and owners download: example payout reports in the shape the upload reads, and an
// owner statement as a spreadsheet or as a page to read, print or save as a PDF. Built in the app
// from data it already has; nothing is fetched.

// --- Example payout reports. The codes are made up, so they match no real stay.
const day = (period: string, n: number) => `${period}-${String(n).padStart(2, '0')}`;
const usDay = (period: string, n: number) => { const [y, m] = period.split('-'); return `${m}/${String(n).padStart(2, '0')}/${y}`; };
export function payoutExampleCsv(channel: 'airbnb' | 'booking_com', period: string): { fileName: string; csv: string } {
  const rows: (string | number)[][] = channel === 'airbnb'
    ? [['Date', 'Type', 'Confirmation Code', 'Start Date', 'Nights', 'Guest', 'Listing', 'Details', 'Reference', 'Currency', 'Amount', 'Paid Out', 'Host Fee', 'Cleaning Fee'],
      [usDay(period, 6), 'Payout', '', '', '', '', '', 'Transfer to account ending 1234', '', 'GBP', '', '612.40', '', ''],
      [usDay(period, 5), 'Reservation', 'HMEXAMPLE01', usDay(period, 2), 3, 'Example Guest', 'Example flat', '', '', 'GBP', '412.40', '', '-12.60', '45.00'],
      [usDay(period, 5), 'Reservation', 'HMEXAMPLE02', usDay(period, 3), 2, 'Another Guest', 'Example cottage', '', '', 'GBP', '200.00', '', '-6.00', '40.00'],
      [usDay(period, 12), 'Resolution Adjustment', 'HMEXAMPLE01', '', '', 'Example Guest', 'Example flat', 'Damage claim', '', 'GBP', '35.00', '', '', '']]
    : [['Reservation number', 'Check-in date', 'Check-out date', 'Guest name', 'Currency', 'Room sales', 'Commission', 'Payments service fee', 'Payout amount', 'Payout date'],
      ['1000000001', day(period, 3), day(period, 6), 'Example Guest', 'GBP', '480.00', '-72.00', '-6.72', '401.28', day(period, 10)],
      ['1000000002', day(period, 8), day(period, 10), 'Another Guest', 'GBP', '260.00', '-39.00', '-3.64', '217.36', day(period, 14)]];
  return { fileName: `Example-${channel === 'airbnb' ? 'Airbnb' : 'Booking.com'}-payouts-${period}.csv`, csv: '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' };
}
// Each example is read by the same code as an upload, so it always matches what the upload expects.
export const payoutExampleCheck = (channel: 'airbnb' | 'booking_com', period: string) => readPayoutReport(payoutExampleCsv(channel, period).csv.replace(/^\uFEFF/, ''));

// --- Owner statements.
const PLATFORM: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other' };
const STATUS: Record<string, string> = { draft: 'Draft, not yet issued', issued: 'Issued', paid: 'Paid', void: 'Void' };
const money = (minor: number) => (minor < 0 ? '-' : '') + '£' + (Math.abs(minor) / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Spreadsheet amounts: deductions in brackets, the accounting way (a leading minus would be treated as a formula).
const plain = (minor: number) => minor < 0 ? `(${(-minor / 100).toFixed(2)})` : (minor / 100).toFixed(2);
const monthName = (period: string) => new Date(period + '-01T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDay = (iso: string) => new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const slug = (text: string) => text.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'property';
export const statementFileName = (propertyName: string, period: string, ext: 'csv' | 'html') => `Recharge-statement-${slug(propertyName)}-${period}.${ext}`;

export function statementCsv(value: unknown) {
  const s = statementSchema.parse(value);
  const rows: (string | number)[][] = [
    ['Recharge owner statement'], ['Property', s.propertyName], ['Month', monthName(s.period)], ['Status', STATUS[s.status] ?? s.status],
    ...(s.status === 'paid' ? [['Paid', `${s.paidAt ? s.paidAt.slice(0, 10) : ''} by bank transfer, reference ${s.payoutReference ?? ''}`]] : []),
    [], ['Stays'], ['Reference', 'Platform', 'Check-in', 'Check-out', 'Amount GBP'],
    ...s.detail.stays.map(x => [x.reference, PLATFORM[x.channel] ?? x.channel, x.checkIn, x.checkOut, plain(x.amountMinor)]),
    [], ['Costs'], ['Supplier', 'Invoice', 'Amount GBP'],
    ...s.detail.expenses.map(x => [x.supplier, x.reference, plain(-x.amountMinor)]),
    [], ['Summary', 'Amount GBP'],
    ['Payouts received', plain(s.revenueMinor)],
    [`Cleaning (${s.cleaningCount} at ${money(s.detail.cleaningCostMinor)})`, plain(-s.cleaningMinor)],
    ['Repairs and supplies', plain(-s.expensesMinor)],
    [`Management fee (${s.feeBps / 100}%)`, plain(-s.feeMinor)],
    [s.payoutMinor < 0 ? 'Owner owes' : 'Due to owner', plain(Math.abs(s.payoutMinor))],
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// The statement as a page: the month's stays and costs, the fee and what is due. Owners read it as
// "your payout"; Accounts see the same figures as "due to the owner".
export function statementDocument(value: unknown, audience: 'owner' | 'accounts' = 'owner') {
  const s = statementSchema.parse(value);
  const owner = audience === 'owner', owes = s.payoutMinor < 0;
  const result = owes ? (owner ? 'You owe' : 'Owner owes') : owner ? 'Your payout' : 'Due to the owner';
  const costs = s.cleaningMinor + s.expensesMinor;
  const tile = (n: string, label: string, strong = false) => `<div class="tile${strong ? ' strong' : ''}"><b>${n}</b><span>${label}</span></div>`;
  const stays = s.detail.stays.length ? `<table><thead><tr><th>Stay</th><th>Platform</th><th>Dates</th><th class="num">Amount</th></tr></thead><tbody>${s.detail.stays.map(x => `<tr><td>${esc(x.reference)}</td><td>${esc(PLATFORM[x.channel] ?? x.channel)}</td><td>${shortDay(x.checkIn)} to ${shortDay(x.checkOut)}</td><td class="num">${money(x.amountMinor)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No stays this month.</p>';
  const expenses = s.detail.expenses.length ? `<table><thead><tr><th>Supplier</th><th>Invoice</th><th class="num">Amount</th></tr></thead><tbody>${s.detail.expenses.map(x => `<tr><td>${esc(x.supplier)}</td><td>${esc(x.reference)}</td><td class="num">${money(-x.amountMinor)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No repairs or supplies this month.</p>';
  const line = (label: string, minor: number, strong = false) => `<tr${strong ? ' class="total"' : ''}><td>${esc(label)}</td><td class="num">${money(minor)}</td></tr>`;
  const settled = s.status === 'paid' ? `Paid by bank transfer${s.paidAt ? ' on ' + shortDay(s.paidAt) : ''}, reference ${esc(s.payoutReference ?? '')}.`
    : s.status === 'issued' ? `Issued${s.issuedAt ? ' on ' + shortDay(s.issuedAt) : ''}.${owes ? '' : owner ? ' Your payout is being prepared.' : ' The payout is still to be made.'}`
    : s.status === 'draft' ? 'Draft: these figures may change before the statement is issued.' : 'This statement has been voided.';
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Statement: ${esc(s.propertyName)}, ${esc(monthName(s.period))}</title>
<style>
:root{--ink:#17302A;--muted:#5B6B65;--line:#DDD5C6;--wash:#F3EEE4;--forest:#1D4038;--bad:#8A3B3B}
*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 "Segoe UI",Helvetica,Arial,sans-serif;padding:0 16px}
.wrap{max-width:860px;margin:0 auto;padding:28px 0 48px;display:flex;flex-direction:column;gap:26px}
header{background:var(--forest);color:#F3EEE4;border-radius:20px;padding:24px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
header small{letter-spacing:.12em;text-transform:uppercase;color:#B9C9C1;font-weight:700;font-size:12px}h1{margin:6px 0 4px;font-size:26px;line-height:1.2}header p{margin:0;color:#B9C9C1}
.status{align-self:flex-start;background:#F3EEE4;color:var(--forest);border-radius:999px;padding:4px 12px;font-weight:700;font-size:13px}
h2{font-size:18px;margin:0 0 10px}.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.tile{border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:2px}.tile b{font-size:22px;font-variant-numeric:tabular-nums}.tile span{color:var(--muted);font-size:13px}
.tile.strong{background:var(--wash);border-color:var(--forest)}
@media(max-width:620px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
.box{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:9px 10px;border-top:1px solid var(--line);vertical-align:top}
thead th{border-top:0;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.total td{font-weight:700;border-top:2px solid var(--ink)}.muted{color:var(--muted)}.bad{color:var(--bad);font-weight:700}
footer{color:var(--muted);font-size:13px;border-top:1px solid var(--line);padding-top:14px}
@media print{body{padding:0}.wrap{padding:0}header,.tile.strong{-webkit-print-color-adjust:exact;print-color-adjust:exact}tr,.tile{break-inside:avoid}}
</style></head><body><div class="wrap">
<header><div><small>Recharge · Owner statement</small><h1>${esc(s.propertyName)}</h1><p>${esc(monthName(s.period))}</p></div><span class="status">${esc(STATUS[s.status] ?? s.status)}</span></header>
<section><div class="tiles">${tile(money(s.revenueMinor), 'booking income')}${tile(money(-costs), 'cleaning, repairs and supplies')}${tile(money(-s.feeMinor), `management fee (${s.feeBps / 100}%)`)}${tile(money(Math.abs(s.payoutMinor)), result.toLowerCase(), true)}</div>
<p class="${owes ? 'bad' : 'muted'}" style="margin-top:12px">${settled}</p></section>
<section><h2>Stays</h2><div class="box">${stays}</div></section>
<section><h2>Repairs and supplies</h2><div class="box">${expenses}</div></section>
<section><h2>Summary</h2><div class="box"><table><tbody>
${line('Payouts received', s.revenueMinor)}${line(`Cleaning (${s.cleaningCount} at ${money(s.detail.cleaningCostMinor)})`, -s.cleaningMinor)}${line('Repairs and supplies', -s.expensesMinor)}${line(`Management fee (${s.feeBps / 100}%)`, -s.feeMinor)}${line(result, Math.abs(s.payoutMinor), true)}
</tbody></table></div></section>
<footer>Prepared by Recharge from the stays, payouts and approved costs recorded for this property. Amounts are in pounds sterling. Questions? Message us in the app.</footer>
</div></body></html>
`;
}
