import { z } from 'zod';
import { brandCanvas, darkBrandCanvas, depthTokens, designTokens } from './design-tokens';
import { formatMoney } from './format';

// Cleaner invoices (migration 20261022000000). At the end of each pay period (weekly, Monday to Sunday, or monthly) each
// cleaner's accepted cleans become one invoice, RC-CLN-YYYY-NNNN, "To approve". Accounts approve it (or query it with a
// note to the cleaner), then mark it paid with the date. The cleaner sees their earnings, what is waiting to be paid and
// what is projected, and every invoice opens as the same designed document on screen and as a print-ready page (save as
// PDF from the browser's print). This file holds the shapes the database returns, the requests the screens send, the
// Accounts groupings, and the invoice document itself (one view model drawn by the app and by the HTML page).

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const PAY_PERIODS = ['weekly', 'monthly'] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];
export const INVOICE_STATUSES = ['to_approve', 'approved', 'paid', 'rejected'] as const;
export type PayInvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const payInvoiceLineSchema = z.object({
  workId: id, cleanOn: day.nullable(), propertyName: z.string(), amountMinor: z.number().int(),
  checkoutTime: z.string().nullable().optional(), nextArrivalOn: day.nullable().optional(), nextArrivalTime: z.string().nullable().optional(),
});
export const payInvoiceSchema = z.object({
  id, number: z.string(), reference: z.string(), generated: z.boolean(),
  cleanerId: id.nullable(), cleanerName: z.string(), supplier: z.string(),
  status: z.enum(INVOICE_STATUSES), queried: z.boolean(), queryNote: z.string().nullable(), queriedAt: z.string().nullable(),
  issueOn: day, periodKind: z.enum(PAY_PERIODS).nullable(), periodStart: day.nullable(), periodEnd: day.nullable(), dueOn: day,
  approvedAt: z.string().nullable(), paidOn: day.nullable(), totalMinor: z.number().int(), currency: z.literal('GBP'), version: z.number().int(), lineCount: z.number().int(),
  lines: z.array(payInvoiceLineSchema).optional(),
});
export type PayInvoice = z.infer<typeof payInvoiceSchema>;
export type PayInvoiceLine = z.infer<typeof payInvoiceLineSchema>;
export const payInvoicesSchema = z.array(payInvoiceSchema);

export const earningsSchema = z.object({
  cleanerId: id, paidThisMonthMinor: z.number(), paidThisYearMinor: z.number(), waitingMinor: z.number(), waitingApprovedMinor: z.number(), waitingToApproveMinor: z.number(), waitingCount: z.number(),
  periodKind: z.enum(PAY_PERIODS), periodStart: day, periodEnd: day, rateMinor: z.number().nullable(),
  acceptedNotInvoicedMinor: z.number(), acceptedNotInvoicedCount: z.number(), unpricedCount: z.number(), upcomingCount: z.number(), upcomingMinor: z.number(), projectedMinor: z.number(),
});
export type Earnings = z.infer<typeof earningsSchema>;

export const paySettingsSchema = z.object({
  canEdit: z.boolean(),
  cleaners: z.array(z.object({ cleanerId: id, fullName: z.string().nullable(), rateMinor: z.number().nullable(), rateVersion: z.number(), period: z.enum(PAY_PERIODS), periodVersion: z.number() })),
});
export type PaySettings = z.infer<typeof paySettingsSchema>;

// The reads (through the Team route, lib/workspace-finance-server.ts) and the requests the screens send.
export const PAY_READ_SECTIONS = { payInvoices: 'invoices', payInvoice: 'invoice', payEarnings: 'earnings', paySettings: 'settings' } as const;
export const payInvoicesQuery = (cleanerId?: string) => ({ section: 'payInvoices', ...(cleanerId ? { userId: cleanerId } : {}) });
export const payInvoiceQuery = (invoiceId: string) => ({ section: 'payInvoice', invoiceId });
export const payEarningsQuery = (cleanerId?: string) => ({ section: 'payEarnings', ...(cleanerId ? { userId: cleanerId } : {}) });
export const paySettingsQuery = () => ({ section: 'paySettings' });
export const approveInvoiceAction = (i: { requestId: string; invoice: Pick<PayInvoice, 'id' | 'version'> }) => ({ action: 'approvePayInvoice' as const, requestId: i.requestId, invoiceId: i.invoice.id, version: i.invoice.version });
export const queryInvoiceAction = (i: { requestId: string; invoice: Pick<PayInvoice, 'id' | 'version'>; note: string }) => ({ action: 'queryPayInvoice' as const, requestId: i.requestId, invoiceId: i.invoice.id, version: i.invoice.version, note: i.note.trim() });
export const markPaidAction = (i: { requestId: string; invoice: Pick<PayInvoice, 'id' | 'version'>; paidOn: string }) => ({ action: 'markPayInvoicePaid' as const, requestId: i.requestId, invoiceId: i.invoice.id, version: i.invoice.version, paidOn: i.paidOn });
export const payPeriodAction = (i: { requestId: string; cleanerId: string; period: PayPeriod; version: number }) => ({ action: 'setCleanerPayPeriod' as const, requestId: i.requestId, cleanerId: i.cleanerId, period: i.period, version: i.version });
export const PAY_ACTIONS = ['approvePayInvoice', 'queryPayInvoice', 'markPayInvoicePaid', 'setCleanerPayPeriod'] as const;

// --- Dates and money, written one way everywhere on the invoice --------------------------------------------------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parts = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return { w: DAYS[d.getUTCDay()], d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()], ml: MONTHS_LONG[d.getUTCMonth()], y: d.getUTCFullYear(), mi: d.getUTCMonth() }; };
// "Mon 6 Oct 2026"
export const longDay = (iso: string) => { const p = parts(iso); return `${p.w} ${p.d} ${p.m} ${p.y}`; };
// "Mon 6 Oct"
export const shortDay = (iso: string) => { const p = parts(iso); return `${p.w} ${p.d} ${p.m}`; };
// "6–12 Oct 2026", "28 Sep – 4 Oct 2026", "29 Dec 2025 – 4 Jan 2026"; a whole calendar month is "October 2026".
export function periodLabel(start: string | null, end: string | null, kind?: PayPeriod | null) {
  if (!start || !end) return null;
  const a = parts(start), b = parts(end);
  if (kind === 'monthly' && a.d === 1 && a.mi === b.mi && a.y === b.y) return `${a.ml} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
  if (a.mi !== b.mi) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d}–${b.d} ${b.m} ${b.y}`;
}
export const money = (minor: number) => formatMoney(minor);

// --- Status ------------------------------------------------------------------------------------------------------
export type StatusTone = 'wait' | 'good' | 'paid' | 'bad';
export function statusOf(i: Pick<PayInvoice, 'status' | 'paidOn' | 'queried'>): { label: string; tone: StatusTone } {
  if (i.status === 'paid') return { label: i.paidOn ? `Paid on ${longDay(i.paidOn)}` : 'Paid', tone: 'paid' };
  if (i.status === 'approved') return { label: 'Approved', tone: 'good' };
  if (i.status === 'rejected') return { label: 'Rejected', tone: 'bad' };
  return { label: i.queried ? 'To approve · queried' : 'To approve', tone: 'wait' };
}
// The status line for the template: "Status: To approve / Approved / Paid (date)".
export const statusLine = (i: Pick<PayInvoice, 'status' | 'paidOn' | 'queried'>) => i.status === 'paid' && i.paidOn ? `Paid (${longDay(i.paidOn)})` : statusOf({ ...i, queried: false }).label;

// --- The invoice document ----------------------------------------------------------------------------------------
export const BILLED_TO = 'Recharge Stays';
export const THANK_YOU = 'Thank you for keeping our homes guest-ready.';
export type InvoiceFact = { label: string; value: string };
export type InvoiceDocLine = { key: string; date: string; property: string; times: string; amount: string };
export type InvoiceDoc = {
  title: 'Invoice'; number: string; status: { label: string; tone: StatusTone; line: string }; paidStamp: string | null;
  from: string; billedTo: string; facts: InvoiceFact[]; showTimes: boolean; lines: InvoiceDocLine[]; count: number;
  subtotal: string; total: string; totalLabel: 'Total due' | 'Total paid'; thanks: string; footer: string;
};
// Check-out and the next guests' arrival when they are known; the next guests only when they arrive that day.
export function lineTimes(l: Pick<PayInvoiceLine, 'checkoutTime' | 'nextArrivalOn' | 'nextArrivalTime' | 'cleanOn'>) {
  const out = [l.checkoutTime ? `Check-out ${l.checkoutTime}` : '', l.nextArrivalTime && l.nextArrivalOn && l.cleanOn && l.nextArrivalOn === l.cleanOn ? `Next guests ${l.nextArrivalTime}` : ''];
  return out.filter(Boolean).join(' · ');
}
// Everything the template shows, empty fields left out (never placeholder text).
export function invoiceDoc(i: PayInvoice): InvoiceDoc {
  const lines = (i.lines ?? []).map(l => ({ key: l.workId, date: l.cleanOn ? shortDay(l.cleanOn) : '', property: l.propertyName, times: lineTimes(l), amount: money(l.amountMinor) }));
  const subtotal = (i.lines ?? []).reduce((t, l) => t + l.amountMinor, 0);
  const s = statusOf(i), paid = i.status === 'paid';
  const facts: InvoiceFact[] = [
    { label: 'Issue date', value: longDay(i.issueOn) },
    { label: 'Period', value: periodLabel(i.periodStart, i.periodEnd, i.periodKind) ?? '' },
    { label: 'Cleans', value: String(i.lines?.length ?? i.lineCount) },
    paid ? { label: 'Paid on', value: i.paidOn ? longDay(i.paidOn) : '' } : { label: 'Due date', value: i.status === 'rejected' ? '' : longDay(i.dueOn) },
  ].filter(f => f.value);
  return {
    title: 'Invoice', number: i.number, status: { ...s, line: statusLine(i) }, paidStamp: paid && i.paidOn ? `Paid ${longDay(i.paidOn)}` : paid ? 'Paid' : null,
    from: i.cleanerName || i.supplier, billedTo: BILLED_TO, facts, showTimes: lines.some(l => l.times), lines, count: lines.length || i.lineCount,
    subtotal: money(lines.length ? subtotal : i.totalMinor), total: money(i.totalMinor), totalLabel: paid ? 'Total paid' : 'Total due', thanks: THANK_YOU,
    footer: `${BILLED_TO} · ${i.number}`,
  };
}
export const invoiceFileName = (i: Pick<PayInvoice, 'number'>) => `${i.number.replace(/[^A-Za-z0-9-]+/g, '-')}.html`;

// The template's colours, all from the app's light theme (paper is always light, also in dark mode and in print).
const paper = designTokens.light;
export const INVOICE_PAPER = {
  page: paper.surface, band: brandCanvas, ink: paper.text, muted: paper.muted, rule: paper.border, zebra: paper.background, forest: darkBrandCanvas,
  tone: {
    wait: { wash: paper.cautionWash, ink: paper.waiting },
    good: { wash: paper.wash, ink: paper.primary },
    paid: { wash: paper.successWash, ink: paper.success },
    bad: { wash: paper.dangerWash, ink: paper.danger },
  } satisfies Record<StatusTone, { wash: string; ink: string }>,
};
// The supplied logo (docs/BRAND.md) has generous margins around the line art; the app's CompanyLogo clips them in the
// layout, never by editing the file, and the template does the same: width, height and offsets for a given width.
export const LOGO_FILE = 'recharge-company-logo.png';
export const logoBox = (width: number) => { const s = width / 1900; return { width, height: Math.round(400 * s), imageWidth: Math.round(2171 * s), imageHeight: Math.round(724 * s), left: -Math.round(105 * s), top: -Math.round(110 * s) }; };

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// The invoice as a page: A4 portrait, one page for a usual invoice; a long one runs on with the table header repeated
// and "page X of Y" in the footer of each page. Vector text, so the PDF saved from print is crisp. `origin` is where the
// logo and the Montserrat files are served (the app's own site; a file:// folder for the sample).
export function invoiceHtml(i: PayInvoice, options: { origin?: string } = {}) {
  const doc = invoiceDoc(i), origin = (options.origin ?? 'https://app.rechargegroup.co.uk').replace(/\/$/, ''), c = INVOICE_PAPER, tone = c.tone[doc.status.tone], logo = logoBox(188);
  const font = (weight: number) => `@font-face{font-family:"Montserrat";font-weight:${weight};font-style:normal;src:url("${origin}/fonts/montserrat-${weight}.ttf") format("truetype")}`;
  const facts = doc.facts.map(f => `<div class="fact"><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('');
  const rows = doc.lines.map(l => `<tr><td class="date">${escape(l.date)}</td><td>${escape(l.property)}</td>${doc.showTimes ? `<td class="times">${escape(l.times)}</td>` : ''}<td class="num">${escape(l.amount)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${escape(doc.number)} · ${escape(doc.from)}</title>
<style>${font(400)}${font(600)}
@page{size:A4 portrait;margin:16mm 16mm 20mm;@bottom-left{content:"${escape(doc.footer)}";font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-scheme:light}
body{margin:0;background:${c.band};color:${c.ink};font:400 10pt/1.5 "Montserrat",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
.sheet{max-width:794px;margin:24px auto;background:${c.page};border-radius:14px;overflow:hidden;box-shadow:${depthTokens.light['elev-2']}}
.band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 40px;background:${c.band};border-bottom:1px solid ${c.rule}}
.logo{position:relative;width:${logo.width}px;height:${logo.height}px;overflow:hidden;flex:none}.logo img{position:absolute;width:${logo.imageWidth}px;height:${logo.imageHeight}px;left:${logo.left}px;top:${logo.top}px}
.title{text-align:right}.word{font-weight:600;font-size:20pt;letter-spacing:.32em;margin-right:-.32em;color:${c.forest};line-height:1.1}.number{margin-top:6px;font-size:10.5pt;letter-spacing:.06em;color:${c.muted}}
.body{padding:28px 40px 36px;position:relative}
.status{display:flex;align-items:center;gap:12px;margin:0 0 26px}.pill{display:inline-block;padding:5px 14px;border-radius:999px;background:${tone.wash};color:${tone.ink};font-weight:600;font-size:9pt;letter-spacing:.02em}
.status .line{color:${c.muted};font-size:9pt}
.stamp{position:absolute;right:46px;top:96px;transform:rotate(-8deg);border:2px solid ${c.forest};color:${c.forest};border-radius:10px;padding:8px 16px;text-align:center;opacity:.78;font-weight:600;letter-spacing:.24em;font-size:15pt;line-height:1.1}
.stamp small{display:block;letter-spacing:.06em;font-size:8pt;font-weight:400;margin-top:4px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:22px}
h2{margin:0 0 4px;font-size:8pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${c.muted}}.party p{margin:0;font-size:12pt;font-weight:600}
.facts{display:grid;grid-template-columns:repeat(${Math.max(doc.facts.length, 1)},1fr);gap:0;margin:0 0 28px;border-top:1px solid ${c.rule};border-bottom:1px solid ${c.rule}}
.fact{padding:12px 14px 12px 0}.fact+.fact{padding-left:14px;border-left:1px solid ${c.rule}}.fact dt{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};margin-bottom:3px}.fact dd{margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};text-align:left;padding:0 10px 8px;border-bottom:1px solid ${c.ink}}
td{padding:9px 10px;border-bottom:1px solid ${c.rule};vertical-align:top}tbody tr:nth-child(even) td{background:${c.zebra}}tr{break-inside:avoid}
.date{white-space:nowrap;width:22%}.times{color:${c.muted};font-size:9pt}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}th.num{text-align:right}
.totals{margin:22px 0 0 auto;width:min(300px,100%);break-inside:avoid}.totals .row{display:flex;justify-content:space-between;gap:16px;padding:6px 10px}.totals .sub{color:${c.muted};border-bottom:1px solid ${c.rule}}
.totals .grand{align-items:baseline;padding-top:12px}.totals .grand span:first-child{font-weight:600;letter-spacing:.04em}.totals .grand span:last-child{font-size:18pt;font-weight:600;color:${c.forest}}
.thanks{margin:44px 0 0;padding-top:16px;border-top:1px solid ${c.rule};color:${c.muted};font-size:9.5pt;break-inside:avoid}.thanks p{margin:0}.thanks .who{margin-top:4px;font-size:8.5pt}
.print{display:block;margin:0 auto 24px;font:600 10pt "Montserrat",Helvetica,Arial,sans-serif;padding:10px 20px;border-radius:999px;border:1px solid ${c.forest};background:${c.page};color:${c.forest};cursor:pointer}
@media print{html,body{background:${c.page}}.sheet{margin:0;max-width:none;border-radius:0;box-shadow:none;overflow:visible}.print{display:none}.band{padding:20px 22px;border-radius:10px;border-bottom:0}.body{padding:22px 0 0}.stamp{right:6px}.thanks{margin-top:24px}.thanks .who{display:none}}
</style></head>
<body>
<main class="sheet" aria-label="Invoice ${escape(doc.number)}">
<header class="band"><div class="logo"><img src="${escape(origin)}/${LOGO_FILE}" alt="Recharge"></div><div class="title"><div class="word">INVOICE</div><div class="number">${escape(doc.number)}</div></div></header>
<div class="body">
<div class="status"><span class="pill">${escape(doc.status.label)}</span><span class="line">Status: ${escape(doc.status.line)}</span></div>
${doc.paidStamp ? `<div class="stamp" aria-hidden="true">PAID<small>${escape(doc.paidStamp.replace(/^Paid /, ''))}</small></div>` : ''}
<section class="parties"><div class="party"><h2>From</h2><p>${escape(doc.from)}</p></div><div class="party"><h2>Billed to</h2><p>${escape(doc.billedTo)}</p></div></section>
<dl class="facts">${facts}</dl>
<table><thead><tr><th>Date</th><th>Property</th>${doc.showTimes ? '<th>Times</th>' : ''}<th class="num">Rate</th></tr></thead><tbody>${rows}</tbody></table>
<section class="totals"><div class="row sub"><span>Subtotal</span><span class="num">${escape(doc.subtotal)}</span></div><div class="row grand"><span>${doc.totalLabel}</span><span class="num">${escape(doc.total)}</span></div></section>
<footer class="thanks"><p>${escape(doc.thanks)}</p><p class="who">${escape(doc.footer)}</p></footer>
</div>
</main>
<button class="print" type="button" onclick="window.print()">Print or save as PDF</button>
</body></html>
`;
}

// --- Accounts: what to pay, by when ------------------------------------------------------------------------------
export type DueBucket = 'overdue' | 'week' | 'month' | 'later';
export const DUE_LABEL: Record<DueBucket, string> = { overdue: 'Overdue', week: 'To pay this week', month: 'To pay this month', later: 'Later' };
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export function dueBucket(dueOn: string, today: string): DueBucket {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay(), sunday = addDays(today, (7 - dow) % 7);
  const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (dueOn < today) return 'overdue';
  if (dueOn <= sunday) return 'week';
  if (dueOn <= monthEnd) return 'month';
  return 'later';
}
export type PayGroup = { bucket: DueBucket; label: string; invoices: PayInvoice[]; byCleaner: { cleanerId: string; name: string; count: number; totalMinor: number }[]; totalMinor: number };
// Approved and not paid yet, grouped by when they fall due (overdue first), each with the total per cleaner; and the total.
export function toPayGroups(invoices: readonly PayInvoice[], today: string): { groups: PayGroup[]; totalMinor: number; count: number } {
  const due = invoices.filter(i => i.status === 'approved').sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.cleanerName.localeCompare(b.cleanerName) || a.number.localeCompare(b.number));
  const groups = (['overdue', 'week', 'month', 'later'] as const).map(bucket => {
    const list = due.filter(i => dueBucket(i.dueOn, today) === bucket);
    const people = new Map<string, { cleanerId: string; name: string; count: number; totalMinor: number }>();
    for (const i of list) { const k = i.cleanerId ?? i.supplier, p = people.get(k) ?? { cleanerId: k, name: i.cleanerName, count: 0, totalMinor: 0 }; p.count++; p.totalMinor += i.totalMinor; people.set(k, p); }
    return { bucket, label: DUE_LABEL[bucket], invoices: list, byCleaner: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)), totalMinor: list.reduce((t, i) => t + i.totalMinor, 0) };
  }).filter(g => g.invoices.length);
  return { groups, totalMinor: due.reduce((t, i) => t + i.totalMinor, 0), count: due.length };
}
export const toApprove = (invoices: readonly PayInvoice[]) => invoices.filter(i => i.status === 'to_approve').sort((a, b) => a.issueOn.localeCompare(b.issueOn) || a.number.localeCompare(b.number));
// The cleaner's own list: everything but rejected, newest first.
export const cleanerList = (invoices: readonly PayInvoice[]) => invoices.filter(i => i.status !== 'rejected');

// The cleaner's three figures, with their words.
export const PROJECTED_LABEL = 'Projected, if all your cleans are accepted';
export function earningsFigures(e: Earnings) {
  return {
    earnings: { label: 'Earnings', value: money(e.paidThisMonthMinor), detail: `Paid this month · ${money(e.paidThisYearMinor)} this year` },
    waiting: { label: 'Waiting to be paid', value: money(e.waitingMinor), detail: e.waitingCount ? `${e.waitingCount} invoice${e.waitingCount === 1 ? '' : 's'}: ${money(e.waitingApprovedMinor)} approved, ${money(e.waitingToApproveMinor)} to approve` : 'Nothing waiting' },
    projected: { label: PROJECTED_LABEL, value: money(e.projectedMinor),
      detail: [`${e.acceptedNotInvoicedCount} accepted, not invoiced yet`, `${e.upcomingCount} more this ${e.periodKind === 'monthly' ? 'month' : 'week'}${e.rateMinor ? ` at ${money(e.rateMinor)}` : ''}`].join(' · ')
        + (e.unpricedCount ? ` · ${e.unpricedCount} waiting for your rate` : '') },
  };
}
