import { brandCanvas, darkBrandCanvas, depthTokens, designTokens } from './design-tokens';
import { REQUEST_TERMS } from './cleaner-invoices';
import { groupTradingName, legalDetails } from './legal-details';
import type { ReceivableItem } from './tracker-receivable';

// Recharge's own invoice document: the bills Recharge sends out (to owners and clients, and anyone else through the invoice
// maker), drawn one way on screen (mobile/src/RechargeInvoice.tsx) and as a page to print, save as PDF or share (rechargeInvoiceHtml).
// It shares its look with the cleaner invoice in lib/cleaner-invoices.ts (invoiceHtml, INVOICE_PAPER, logoBox): cream header
// band with the RECHARGE logo, spaced INVOICE with the number under it, From and Billed to, a row of key facts, a striped
// table, subtotal and a big total, a PAID stamp, a footer. The CSS is a copy on purpose: that file is being reworked
// separately, so the only thing taken from it is the request terms (REQUEST_TERMS), worded once for both kinds of request.
// Change both together to keep them alike.
//
// Where Recharge bills someone (see the report in migration 20261022100000):
//  * public.workspace_invoices bills to an owner: onboarding, direct booking, repair (fromWorkspaceInvoice);
//  * the hub's invoices in Accounts, Receivable, to a client or for a guest stay (fromReceivable);
//  * the invoice maker: an invoice or a request for invoice to anyone (lib/invoice-maker.ts, fromMakerDocument).

export type DocCurrency = 'GBP' | 'USD';
export type DocKind = 'invoice' | 'request';
export type DocStatus = 'draft' | 'to_send' | 'issued' | 'part_paid' | 'paid' | 'void';
export type DocTone = 'wait' | 'good' | 'paid' | 'bad';

// Payment is due this many days after the invoice date: the rule the maker uses for its default due date (Lee, 15 Oct 2026)
// and the cleaner invoices use for theirs. Bills with no due date of their own are shown with this one.
export const INVOICE_DUE_DAYS = 7;
// The terms printed on every document, in one place. Lee may replace the words; the documents follow. A request for invoice
// uses the cleaner requests' words exactly (lib/cleaner-invoices.ts REQUEST_TERMS). {number} in any terms becomes the
// document's number when it is drawn; a draft has none yet, so it reads NUMBER_PENDING until it is issued.
export const DEFAULT_TERMS: Record<DocKind, string> = {
  invoice: `Payment is due within ${INVOICE_DUE_DAYS} days of the invoice date. Please quote the invoice number with your payment.`,
  request: REQUEST_TERMS,
};
export const NUMBER_PENDING = '(given when issued)';
export const termsFor = (terms: string, number?: string | null) => terms.split('{number}').join(number?.trim() || NUMBER_PENDING);
// How to pay Recharge: not in code. Management type it in the app (Invoice maker, Payment details), the database keeps it
// (migration 20261022100000, private.workspace_finance_settings, empty until saved) and hands it out with each document
// as paymentDetails. An invoice shows it as "How to pay" while it is not empty; a request for invoice never does.
export const PAYMENT_DETAILS_MAX = 1000;
export const paymentBlock = (i: Pick<RechargeInvoice, 'kind' | 'paymentDetails'>) => i.kind === 'invoice' ? (i.paymentDetails ?? '').trim() : '';

// Who the document is from: the trading name in bold, the registered address, then the legal line. All from lib/legal-details.ts.
export const FROM_BLOCK = { name: groupTradingName, lines: [legalDetails.registeredAddress, `${legalDetails.legalName} · Company no. ${legalDetails.companyNumber}`] };

export type DocLine = { description: string; quantity?: string | null; rateMinor?: number | null; amountMinor: number };
export type RechargeInvoice = {
  kind: DocKind; number: string | null; status: DocStatus; currency: DocCurrency;
  billedTo: { name: string; lines?: string[] };
  issueOn: string | null; dueOn: string | null; periodStart?: string | null; periodEnd?: string | null; paidOn?: string | null;
  // Extra key facts after the dates (a property, a stay, a reference).
  facts?: { label: string; value: string }[];
  lines: DocLine[];
  // Money already received against it (part payments); the total then shows what is still owed.
  paidSoFarMinor?: number;
  note?: string | null; terms?: string | null; voidReason?: string | null;
  // The saved payment details (see paymentBlock).
  paymentDetails?: string | null;
};

// --- Words for dates and money ----------------------------------------------------------------------------------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); return { w: DAYS[d.getUTCDay()], d: d.getUTCDate(), m: MONTHS[d.getUTCMonth()], mi: d.getUTCMonth(), y: d.getUTCFullYear() }; };
// "Mon 6 Oct 2026"
export const docDay = (iso: string) => { const p = parts(iso); return `${p.w} ${p.d} ${p.m} ${p.y}`; };
// "6 to 12 Oct 2026", "28 Sep to 4 Oct 2026", "29 Dec 2025 to 4 Jan 2026"
export function docPeriod(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return '';
  const a = parts(start), b = parts(end);
  if (a.y !== b.y) return `${a.d} ${a.m} ${a.y} to ${b.d} ${b.m} ${b.y}`;
  if (a.mi !== b.mi) return `${a.d} ${a.m} to ${b.d} ${b.m} ${b.y}`;
  return a.d === b.d ? `${a.d} ${b.m} ${b.y}` : `${a.d} to ${b.d} ${b.m} ${b.y}`;
}
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const grouped = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "£1,234.50", "$80.00"; a negative amount (money received) with a minus sign.
export const docMoney = (minor: number, currency: DocCurrency = 'GBP') => (minor < 0 ? '−' : '') + (currency === 'USD' ? '$' : '£') + grouped.format(Math.abs(minor) / 100);

// --- The document, as the template shows it ----------------------------------------------------------------------
export type DocFact = { label: string; value: string };
export type DocChip = { label: string; tone: DocTone };
export type DocRow = { key: string; description: string; quantity: string; rate: string; amount: string };
export type RechargeInvoiceDoc = {
  word: 'INVOICE' | 'REQUEST FOR INVOICE'; title: string; number: string; chip: DocChip | null; stamp: { word: 'PAID' | 'VOID'; detail: string } | null;
  from: { name: string; lines: string[] }; to: { label: 'Billed to' | 'Requested from'; name: string; lines: string[] };
  facts: DocFact[]; showQuantities: boolean; rows: DocRow[]; empty: string;
  subtotal: string; adjustments: { label: string; value: string }[]; total: string; totalLabel: 'Total due' | 'Total paid' | 'Balance due' | 'Amount to invoice' | 'Total';
  note: string; terms: string; payment: string; thanks: string; footer: string;
};
const THANKS: Record<DocKind, string> = { invoice: 'Thank you for your business.', request: 'Thank you.' };

export function rechargeInvoiceDoc(i: RechargeInvoice, options: { today?: string } = {}): RechargeInvoiceDoc {
  const request = i.kind === 'request', money = (m: number) => docMoney(m, i.currency);
  const subtotalMinor = i.lines.reduce((t, l) => t + l.amountMinor, 0);
  const paidSoFar = i.status === 'paid' || i.status === 'void' ? 0 : Math.max(0, i.paidSoFarMinor ?? 0);
  const overdue = !!options.today && !!i.dueOn && i.dueOn < options.today;
  const chip: DocChip | null = i.status === 'draft' ? { label: 'Draft, not issued', tone: 'wait' }
    : i.status === 'to_send' ? { label: 'To send', tone: 'wait' }
    : i.status === 'void' ? { label: 'Void', tone: 'bad' }
    : i.status === 'paid' ? null
    : overdue ? { label: 'Overdue', tone: 'bad' }
    : i.status === 'part_paid' ? { label: 'Part paid', tone: 'wait' }
    : i.dueOn ? { label: `Due ${docDay(i.dueOn)}`, tone: 'good' } : null;
  const facts: DocFact[] = [
    { label: request ? 'Request date' : 'Issue date', value: i.issueOn ? docDay(i.issueOn) : '' },
    i.status === 'paid' ? { label: 'Paid on', value: i.paidOn ? docDay(i.paidOn) : '' } : { label: 'Due date', value: i.dueOn ? docDay(i.dueOn) : '' },
    { label: 'Period', value: docPeriod(i.periodStart, i.periodEnd) },
    ...(i.facts ?? []),
    { label: 'Currency', value: i.currency === 'USD' ? 'US dollars' : '' },
  ].filter(f => f.value);
  const showQuantities = i.lines.some(l => (l.quantity ?? '') !== '' || l.rateMinor != null);
  const rows = i.lines.map((l, n) => ({ key: String(n), description: l.description, quantity: l.quantity ?? '', rate: l.rateMinor != null ? money(l.rateMinor) : '', amount: money(l.amountMinor) }));
  const number = i.number?.trim() || (i.status === 'draft' ? 'DRAFT' : 'No number yet');
  const totalLabel = request ? 'Amount to invoice' : i.status === 'paid' ? 'Total paid' : paidSoFar > 0 ? 'Balance due' : i.status === 'void' ? 'Total' : 'Total due';
  return {
    word: request ? 'REQUEST FOR INVOICE' : 'INVOICE', title: request ? 'Request for invoice' : 'Invoice', number, chip,
    stamp: i.status === 'paid' ? { word: 'PAID', detail: i.paidOn ? docDay(i.paidOn) : '' } : i.status === 'void' ? { word: 'VOID', detail: i.voidReason?.trim() ?? '' } : null,
    from: { name: FROM_BLOCK.name, lines: [...FROM_BLOCK.lines] },
    to: { label: request ? 'Requested from' : 'Billed to', name: i.billedTo.name.trim() || 'Not chosen yet', lines: (i.billedTo.lines ?? []).map(l => l.trim()).filter(Boolean) },
    facts, showQuantities, rows, empty: 'No lines yet.',
    subtotal: money(subtotalMinor), adjustments: paidSoFar > 0 ? [{ label: 'Paid so far', value: money(-paidSoFar) }] : [],
    total: money(subtotalMinor - paidSoFar), totalLabel,
    note: i.note?.trim() ?? '', terms: termsFor((i.terms ?? DEFAULT_TERMS[i.kind]).trim(), i.number), payment: paymentBlock(i),
    thanks: THANKS[i.kind], footer: `${groupTradingName} · ${legalDetails.legalName} · Company no. ${legalDetails.companyNumber}${i.number ? ' · ' + i.number : ''}`,
  };
}
export const rechargeInvoiceFileName = (i: Pick<RechargeInvoice, 'number' | 'kind'>) => `${(i.number?.trim() || (i.kind === 'request' ? 'request-for-invoice' : 'invoice')).replace(/[^A-Za-z0-9-]+/g, '-')}.html`;

// The template's colours, all from the app's light theme (paper is always light, also in dark mode and in print).
const paper = designTokens.light;
export const RECHARGE_PAPER = {
  page: paper.surface, band: brandCanvas, ink: paper.text, muted: paper.muted, rule: paper.border, zebra: paper.background, forest: darkBrandCanvas, danger: paper.danger,
  tone: {
    wait: { wash: paper.cautionWash, ink: paper.waiting },
    good: { wash: paper.wash, ink: paper.primary },
    paid: { wash: paper.successWash, ink: paper.success },
    bad: { wash: paper.dangerWash, ink: paper.danger },
  } satisfies Record<DocTone, { wash: string; ink: string }>,
};
// The supplied logo has generous margins; it is clipped in the layout, never by editing the file (as lib/cleaner-invoices.ts).
export const RECHARGE_LOGO_FILE = 'recharge-company-logo.png';
export const rechargeLogoBox = (width: number) => { const s = width / 1900; return { width, height: Math.round(400 * s), imageWidth: Math.round(2171 * s), imageHeight: Math.round(724 * s), left: -Math.round(105 * s), top: -Math.round(110 * s) }; };

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const multiline = (text: string) => text.split(/\r?\n/).map(escape).join('<br>');

// The document as a page: A4 portrait, the table header repeated on a long one, "Page X of Y" in the print footer. `origin`
// is where the logo and the Montserrat files are served (the app's own site; a file:// folder for the sample).
export function rechargeInvoiceHtml(i: RechargeInvoice, options: { origin?: string; today?: string } = {}) {
  const doc = rechargeInvoiceDoc(i, options), origin = (options.origin ?? 'https://app.rechargegroup.co.uk').replace(/\/$/, ''), c = RECHARGE_PAPER, logo = rechargeLogoBox(188);
  const tone = c.tone[doc.chip?.tone ?? 'good'], stampInk = doc.stamp?.word === 'VOID' ? c.danger : c.forest;
  const font = (weight: number) => `@font-face{font-family:"Montserrat";font-weight:${weight};font-style:normal;src:url("${origin}/fonts/montserrat-${weight}.ttf") format("truetype")}`;
  const party = (label: string, p: { name: string; lines: string[] }) => `<div class="party"><h2>${escape(label)}</h2><p class="name">${escape(p.name)}</p>${p.lines.map(l => `<p>${escape(l)}</p>`).join('')}</div>`;
  const facts = doc.facts.map(f => `<div class="fact"><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('');
  const head = `<tr><th>Description</th>${doc.showQuantities ? '<th class="num">Qty</th><th class="num">Rate</th>' : ''}<th class="num">Amount</th></tr>`;
  const rows = doc.rows.length ? doc.rows.map(r => `<tr><td>${escape(r.description)}</td>${doc.showQuantities ? `<td class="num">${escape(r.quantity)}</td><td class="num">${escape(r.rate)}</td>` : ''}<td class="num">${escape(r.amount)}</td></tr>`).join('')
    : `<tr><td class="none" colspan="${doc.showQuantities ? 4 : 2}">${escape(doc.empty)}</td></tr>`;
  const adjustments = doc.adjustments.map(a => `<div class="row sub"><span>${escape(a.label)}</span><span class="num">${escape(a.value)}</span></div>`).join('');
  const payment = doc.payment ? `<section class="block"><h2>How to pay</h2><p>${multiline(doc.payment)}</p></section>` : '';
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(doc.title)} ${escape(doc.number)} · ${escape(groupTradingName)}</title>
<style>${font(400)}${font(600)}
@page{size:A4 portrait;margin:16mm 16mm 20mm;@bottom-left{content:"${escape(doc.footer)}";font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-scheme:light}
body{margin:0;background:${c.band};color:${c.ink};font:400 10pt/1.5 "Montserrat",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
.sheet{max-width:794px;margin:24px auto;background:${c.page};border-radius:14px;overflow:hidden;box-shadow:${depthTokens.light['elev-2']}}
.band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 40px;background:${c.band};border-bottom:1px solid ${c.rule}}
.logo{position:relative;width:${logo.width}px;height:${logo.height}px;overflow:hidden;flex:none}.logo img{position:absolute;width:${logo.imageWidth}px;height:${logo.imageHeight}px;left:${logo.left}px;top:${logo.top}px}
.title{text-align:right}.word{font-weight:600;font-size:${doc.word === 'INVOICE' ? 20 : 15}pt;letter-spacing:.32em;margin-right:-.32em;color:${c.forest};line-height:1.1}.number{margin-top:6px;font-size:10.5pt;letter-spacing:.06em;color:${c.muted}}
.body{padding:28px 40px 36px;position:relative}
.status{display:flex;align-items:center;gap:12px;margin:0 0 26px}.pill{display:inline-block;padding:5px 14px;border-radius:999px;background:${tone.wash};color:${tone.ink};font-weight:600;font-size:9pt;letter-spacing:.02em}
.stamp{position:absolute;right:46px;top:${doc.chip ? 96 : 20}px;transform:rotate(-8deg);border:2px solid ${stampInk};color:${stampInk};border-radius:10px;padding:8px 16px;text-align:center;opacity:.78;font-weight:600;letter-spacing:.24em;font-size:15pt;line-height:1.1;max-width:220px}
.stamp small{display:block;letter-spacing:.06em;font-size:8pt;font-weight:400;margin-top:4px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:22px}
h2{margin:0 0 4px;font-size:8pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${c.muted}}.party p{margin:0;font-size:9.5pt;color:${c.muted}}.party p.name{font-size:12pt;font-weight:600;color:${c.ink};margin-bottom:2px}
.facts{display:grid;grid-template-columns:repeat(${Math.max(doc.facts.length, 1)},1fr);gap:0;margin:0 0 28px;border-top:1px solid ${c.rule};border-bottom:1px solid ${c.rule}}
.fact{padding:12px 14px 12px 0}.fact+.fact{padding-left:14px;border-left:1px solid ${c.rule}}.fact dt{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};margin-bottom:3px}.fact dd{margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};text-align:left;padding:0 10px 8px;border-bottom:1px solid ${c.ink}}
td{padding:9px 10px;border-bottom:1px solid ${c.rule};vertical-align:top}tbody tr:nth-child(even) td{background:${c.zebra}}tr{break-inside:avoid}td.none{color:${c.muted}}
.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}th.num{text-align:right}
.totals{margin:22px 0 0 auto;width:min(320px,100%);break-inside:avoid}.totals .row{display:flex;justify-content:space-between;gap:16px;padding:6px 10px}.totals .sub{color:${c.muted};border-bottom:1px solid ${c.rule}}
.totals .grand{align-items:baseline;padding-top:12px}.totals .grand span:first-child{font-weight:600;letter-spacing:.04em}.totals .grand span:last-child{font-size:18pt;font-weight:600;color:${c.forest}}
.block{margin:26px 0 0;break-inside:avoid}.block p{margin:0;font-size:9.5pt}
.thanks{margin:36px 0 0;padding-top:16px;border-top:1px solid ${c.rule};color:${c.muted};font-size:9.5pt;break-inside:avoid}.thanks p{margin:0}.thanks .who{margin-top:4px;font-size:8.5pt}
.print{display:block;margin:0 auto 24px;font:600 10pt "Montserrat",Helvetica,Arial,sans-serif;padding:10px 20px;border-radius:999px;border:1px solid ${c.forest};background:${c.page};color:${c.forest};cursor:pointer}
@media (max-width:600px){.band,.body{padding-left:20px;padding-right:20px}.parties{grid-template-columns:1fr}.facts{grid-template-columns:1fr 1fr}.fact:nth-child(odd){padding-left:0;border-left:0}.stamp{right:16px}}
@media print{html,body{background:${c.page}}.sheet{margin:0;max-width:none;border-radius:0;box-shadow:none;overflow:visible}.print{display:none}.band{padding:20px 22px;border-radius:10px;border-bottom:0}.body{padding:22px 0 0}.stamp{right:6px}.thanks{margin-top:24px}.thanks .who{display:none}}
</style></head>
<body>
<main class="sheet" aria-label="${escape(doc.title)} ${escape(doc.number)}">
<header class="band"><div class="logo"><img src="${escape(origin)}/${RECHARGE_LOGO_FILE}" alt="Recharge"></div><div class="title"><div class="word">${doc.word}</div><div class="number">${escape(doc.number)}</div></div></header>
<div class="body">
${doc.chip ? `<div class="status"><span class="pill">${escape(doc.chip.label)}</span></div>` : ''}
${doc.stamp ? `<div class="stamp" aria-hidden="true">${doc.stamp.word}${doc.stamp.detail ? `<small>${escape(doc.stamp.detail)}</small>` : ''}</div>` : ''}
<section class="parties">${party('From', doc.from)}${party(doc.to.label, doc.to)}</section>
<dl class="facts">${facts}</dl>
<table><thead>${head}</thead><tbody>${rows}</tbody></table>
<section class="totals"><div class="row sub"><span>Subtotal</span><span class="num">${escape(doc.subtotal)}</span></div>${adjustments}<div class="row grand"><span>${doc.totalLabel}</span><span class="num">${escape(doc.total)}</span></div></section>
${doc.note ? `<section class="block"><h2>Note</h2><p>${multiline(doc.note)}</p></section>` : ''}
${doc.terms ? `<section class="block"><h2>Terms</h2><p>${multiline(doc.terms)}</p></section>` : ''}
${payment}
<footer class="thanks"><p>${escape(doc.thanks)}</p><p class="who">${escape(doc.footer)}</p></footer>
</div>
</main>
<button class="print" type="button" onclick="window.print()">Print or save as PDF</button>
</body></html>
`;
}

// --- Bills Recharge already issues --------------------------------------------------------------------------------
// One public.workspace_invoices bill to an owner, as public.workspace_documents_read('invoice') returns it.
export type WorkspaceInvoiceDoc = {
  source: 'workspace'; id: string; module: string; reference: string; status: string; issueOn: string; paidOn: string | null;
  amountMinor: number; currency: string; version: number; recipientName: string; propertyName: string | null; propertyAddress: string | null;
  workTitle: string | null; stay: { reference: string | null; checkIn: string; checkOut: string } | null; paymentDetails?: string | null;
};
export const OWNER_BILL_MODULES = ['onboarding-invoices', 'owner-statements', 'maintenance-reconciliation'] as const;
// Whether an invoice row is one of Recharge's bills to an owner (and so has a document).
export const isOwnerBill = (module: string | null | undefined) => !!module && (OWNER_BILL_MODULES as readonly string[]).includes(module);
const BILL_LINE: Record<string, (i: WorkspaceInvoiceDoc) => string> = {
  'onboarding-invoices': i => `Property onboarding${i.propertyName ? ', ' + i.propertyName : ''}`,
  'owner-statements': i => `Direct booking${i.stay?.reference ? ' ' + i.stay.reference : ''}${i.propertyName ? ', ' + i.propertyName : ''}`,
  'maintenance-reconciliation': i => `Repair${i.workTitle ? ': ' + i.workTitle : ''}${i.propertyName ? ', ' + i.propertyName : ''}`,
};
export function fromWorkspaceInvoice(i: WorkspaceInvoiceDoc): RechargeInvoice {
  const status: DocStatus = i.status === 'paid' ? 'paid' : i.status === 'void' ? 'void' : 'issued';
  return {
    kind: 'invoice', number: i.reference, status, currency: i.currency === 'USD' ? 'USD' : 'GBP',
    billedTo: { name: i.recipientName },
    issueOn: i.issueOn, dueOn: addDays(i.issueOn, INVOICE_DUE_DAYS), paidOn: i.paidOn,
    periodStart: i.stay?.checkIn ?? null, periodEnd: i.stay?.checkOut ?? null,
    // The property's address when it already starts with its name ("14 Example Terrace, Edinburgh"), else both.
    facts: [{ label: 'Property', value: i.propertyAddress && i.propertyName && i.propertyAddress.startsWith(i.propertyName) ? i.propertyAddress : [i.propertyName, i.propertyAddress].filter(Boolean).join(', ') }].filter(f => f.value),
    lines: [{ description: (BILL_LINE[i.module] ?? (() => 'Services'))(i), amountMinor: i.amountMinor }],
    paymentDetails: i.paymentDetails ?? null,
  };
}
// A hub invoice in Accounts, Receivable (finance roles only, as the report). To send, sent, part paid; the client, the stay.
export function fromReceivable(r: ReceivableItem, paymentDetails?: string | null): RechargeInvoice {
  const sent = r.status === 'sent', amount = r.amountMinor ?? 0;
  const stay = r.stayReference ? `Stay ${r.stayReference}` : r.reservationId ? 'Guest stay' : '';
  return {
    kind: 'invoice', number: r.reference.trim() || null, status: !sent ? 'to_send' : r.settledMinor > 0 ? 'part_paid' : 'issued', currency: 'GBP',
    billedTo: { name: r.clientName?.trim() || (stay ? 'The guest' : 'Client') },
    issueOn: (r.sentOn ?? r.createdAt).slice(0, 10), dueOn: r.dueOn, periodStart: r.checkIn, periodEnd: r.checkOut,
    facts: [{ label: 'Stay', value: stay }, { label: 'Property', value: r.propertyName ?? r.address ?? '' }].filter(f => f.value),
    lines: [{ description: r.title, amountMinor: amount }],
    // The hub's notes and link are Accounts' own and never printed.
    paidSoFarMinor: sent ? r.settledMinor : 0, paymentDetails: paymentDetails ?? null,
  };
}
