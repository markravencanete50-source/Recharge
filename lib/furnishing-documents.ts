import { depthTokens } from './design-tokens';
import { addDays, docDay, docMoney, FROM_BLOCK, RECHARGE_LOGO_FILE, RECHARGE_PAPER, rechargeLogoBox } from './recharge-invoice';
import { groupTradingName, legalDetails } from './legal-details';
import {
  categoryName, FURNISHING_CATEGORIES, markedUp, PROPERTY_TYPE_LABEL, shoppingGroups, STATUS_LABEL, VAT_PERCENT,
  type EstimateLine, type EstimateTotals, type ProjectStatus, type StudioInputs,
} from './furnishing-studio';

// Furnishing Studio's two documents, in the look of Recharge's invoice (lib/recharge-invoice.ts: cream band with the logo,
// spaced title and number, striped table, big total; always light, A4, "Print or save as PDF"):
//  * the client quote: what the client pays, room by room, with the markup in the prices, the fee and VAT;
//  * the shopping list: what the team buys, by supplier, with the product links, tick boxes and the actual spend.
// The cost caps (what Recharge pays) are on the shopping list only, never on the client quote.

export const QUOTE_VALID_DAYS = 30;
export const QUOTE_TERMS = `This quote is valid for ${QUOTE_VALID_DAYS} days from its date. It covers the items listed, supplied and set up in the property. `
  + 'Quantities are worked out from the property details; items you already have are left out. Prices are confirmed when the quote is accepted.';
export type QuoteDocInput = {
  number: string; status: ProjectStatus; clientName: string; clientEmail: string | null; where: string; estimateOn: string; inputs: StudioInputs;
  markupPercent: number; vat: boolean; notes: string; lines: readonly EstimateLine[]; totals: EstimateTotals;
};
export type QuoteRow = { key: string; description: string; detail: string; quantity: string; rate: string; amount: string };
export type QuoteSection = { key: string; title: string; rows: QuoteRow[] };
export type QuoteDoc = {
  title: string; number: string; chip: string | null; from: { name: string; lines: string[] }; to: { name: string; lines: string[] };
  facts: { label: string; value: string }[]; sections: QuoteSection[]; totals: { label: string; value: string }[]; total: string;
  notes: string; terms: string; footer: string;
};

// The quote as the template shows it. Each price already includes the markup; the fee and VAT are lines of their own.
export function quoteDoc(q: QuoteDocInput): QuoteDoc {
  const buying = q.lines.filter(l => l.packs > 0);
  const sections = FURNISHING_CATEGORIES.map(c => ({ key: c, title: categoryName(c), rows: buying.filter(l => l.category === c).map(l => ({
    key: l.itemId, description: l.name, detail: [l.unit !== 'each' ? l.unit : '', l.existingUnits > 0 ? `${l.existingUnits} already in the property` : ''].filter(Boolean).join(' · '),
    quantity: String(l.packs), rate: docMoney(markedUp(l.unitPricePence, q.markupPercent)), amount: docMoney(l.pricePence),
  })) })).filter(s => s.rows.length);
  const i = q.inputs;
  const beds = [i.zipLinkBeds ? `${i.zipLinkBeds} zip & link` : '', i.doubleBeds ? `${i.doubleBeds} double` : '', i.singleBeds ? `${i.singleBeds} single` : '', i.sofaBeds ? `${i.sofaBeds} sofa bed` : ''].filter(Boolean).join(', ');
  return {
    title: 'Furnishing quote', number: q.number, chip: q.status === 'draft' ? 'Draft, not sent' : q.status === 'sent' ? null : STATUS_LABEL[q.status],
    from: { name: FROM_BLOCK.name, lines: [...FROM_BLOCK.lines] },
    to: { name: q.clientName.trim() || 'Client', lines: [q.where, q.clientEmail ?? ''].map(s => s.trim()).filter(Boolean) },
    facts: [
      { label: 'Quote date', value: docDay(q.estimateOn) },
      { label: 'Valid until', value: docDay(addDays(q.estimateOn, QUOTE_VALID_DAYS)) },
      { label: 'Property', value: `${PROPERTY_TYPE_LABEL[i.propertyType]}, ${i.bedrooms} ${i.bedrooms === 1 ? 'bedroom' : 'bedrooms'}` },
      { label: 'Sleeps', value: String(i.guests) },
      { label: 'Beds', value: beds },
    ].filter(f => f.value),
    sections,
    totals: [
      { label: 'Furnishings', value: docMoney(q.totals.subtotalPence) },
      ...(q.totals.feePence ? [{ label: 'Design and project fee', value: docMoney(q.totals.feePence) }] : []),
      ...(q.vat ? [{ label: `VAT at ${VAT_PERCENT}%`, value: docMoney(q.totals.vatPence) }] : []),
    ],
    total: docMoney(q.totals.quotePence), notes: q.notes.trim(), terms: QUOTE_TERMS,
    footer: `${groupTradingName} · ${legalDetails.legalName} · Company no. ${legalDetails.companyNumber} · ${q.number}`,
  };
}
export const quoteFileName = (number: string, kind: 'quote' | 'shopping-list') => `${number.replace(/[^A-Za-z0-9-]+/g, '-')}-${kind}.html`;

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const multiline = (text: string) => text.split(/\r?\n/).map(escape).join('<br>');
// A link is printed only when it is a plain https:// address.
const safeLink = (url: string | null | undefined) => url && /^https:\/\/[^\s"<>]+$/.test(url) ? url : null;

// The page around both documents: A4, the header row repeated on a long table, "Page X of Y" in the print footer.
function page(title: string, number: string, footer: string, origin: string, body: string) {
  const c = RECHARGE_PAPER, logo = rechargeLogoBox(188);
  const font = (weight: number) => `@font-face{font-family:"Montserrat";font-weight:${weight};font-style:normal;src:url("${origin}/fonts/montserrat-${weight}.ttf") format("truetype")}`;
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} ${escape(number)} · ${escape(groupTradingName)}</title>
<style>${font(400)}${font(600)}
@page{size:A4 portrait;margin:16mm 16mm 20mm;@bottom-left{content:"${escape(footer)}";font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-scheme:light}
body{margin:0;background:${c.band};color:${c.ink};font:400 10pt/1.5 "Montserrat",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
.sheet{max-width:794px;margin:24px auto;background:${c.page};border-radius:14px;overflow:hidden;box-shadow:${depthTokens.light['elev-2']}}
.band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 40px;background:${c.band};border-bottom:1px solid ${c.rule}}
.logo{position:relative;width:${logo.width}px;height:${logo.height}px;overflow:hidden;flex:none}.logo img{position:absolute;width:${logo.imageWidth}px;height:${logo.imageHeight}px;left:${logo.left}px;top:${logo.top}px}
.title{text-align:right}.word{font-weight:600;font-size:15pt;letter-spacing:.3em;margin-right:-.3em;color:${c.forest};line-height:1.1}.number{margin-top:6px;font-size:10.5pt;letter-spacing:.06em;color:${c.muted}}
.body{padding:28px 40px 36px}
.pill{display:inline-block;margin:0 0 22px;padding:5px 14px;border-radius:999px;background:${c.tone.wait.wash};color:${c.tone.wait.ink};font-weight:600;font-size:9pt}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:22px}
h2{margin:0 0 4px;font-size:8pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${c.muted}}.party p{margin:0;font-size:9.5pt;color:${c.muted}}.party p.name{font-size:12pt;font-weight:600;color:${c.ink};margin-bottom:2px}
.facts{display:flex;flex-wrap:wrap;margin:0 0 24px;border-top:1px solid ${c.rule};border-bottom:1px solid ${c.rule}}
.fact{flex:1 1 120px;padding:12px 14px 12px 0}.fact dt{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};margin-bottom:3px}.fact dd{margin:0;font-size:10pt}
h3{margin:20px 0 6px;font-size:9pt;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:${c.forest}}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};text-align:left;padding:0 8px 8px;border-bottom:1px solid ${c.ink}}
td{padding:8px;border-bottom:1px solid ${c.rule};vertical-align:top}tbody tr:nth-child(even) td{background:${c.zebra}}tr{break-inside:avoid}td small{display:block;color:${c.muted};font-size:8.5pt}
td a{color:${c.forest};word-break:break-all}.num{text-align:right;white-space:nowrap}th.num{text-align:right}.box{width:22px}.box span{display:inline-block;width:13px;height:13px;border:1.5px solid ${c.ink};border-radius:3px;text-align:center;line-height:11px;font-size:10px}
.totals{margin:22px 0 0 auto;width:min(340px,100%);break-inside:avoid}.totals .row{display:flex;justify-content:space-between;gap:16px;padding:6px 8px}.totals .sub{color:${c.muted};border-bottom:1px solid ${c.rule}}
.totals .grand{align-items:baseline;padding-top:12px}.totals .grand span:first-child{font-weight:600}.totals .grand span:last-child{font-size:18pt;font-weight:600;color:${c.forest}}
.block{margin:24px 0 0;break-inside:avoid}.block p{margin:0;font-size:9.5pt}
.thanks{margin:32px 0 0;padding-top:14px;border-top:1px solid ${c.rule};color:${c.muted};font-size:8.5pt}
.print{display:block;margin:0 auto 24px;font:600 10pt "Montserrat",Helvetica,Arial,sans-serif;padding:10px 20px;border-radius:999px;border:1px solid ${c.forest};background:${c.page};color:${c.forest};cursor:pointer}
@media (max-width:600px){.band,.body{padding-left:20px;padding-right:20px}.parties{grid-template-columns:1fr}}
@media print{html,body{background:${c.page}}.sheet{margin:0;max-width:none;border-radius:0;box-shadow:none;overflow:visible}.print{display:none}.band{padding:20px 22px;border-radius:10px;border-bottom:0}.body{padding:22px 0 0}}
</style></head>
<body>
<main class="sheet" aria-label="${escape(title)} ${escape(number)}">
<header class="band"><div class="logo"><img src="${escape(origin)}/${RECHARGE_LOGO_FILE}" alt="Recharge"></div><div class="title"><div class="word">${escape(title.toUpperCase())}</div><div class="number">${escape(number)}</div></div></header>
<div class="body">
${body}
<footer class="thanks"><p>${escape(footer)}</p></footer>
</div>
</main>
<button class="print" type="button" onclick="window.print()">Print or save as PDF</button>
</body></html>
`;
}
const party = (label: string, p: { name: string; lines: string[] }) => `<div class="party"><h2>${escape(label)}</h2><p class="name">${escape(p.name)}</p>${p.lines.map(l => `<p>${escape(l)}</p>`).join('')}</div>`;
const factsHtml = (facts: { label: string; value: string }[]) => `<dl class="facts">${facts.map(f => `<div class="fact"><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('')}</dl>`;

export function quoteHtml(q: QuoteDocInput, options: { origin?: string } = {}) {
  const doc = quoteDoc(q), origin = (options.origin ?? 'https://app.rechargegroup.co.uk').replace(/\/$/, '');
  const head = '<tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr>';
  const sections = doc.sections.length ? doc.sections.map(s => `<h3>${escape(s.title)}</h3><table><thead>${head}</thead><tbody>${s.rows.map(r =>
    `<tr><td>${escape(r.description)}${r.detail ? `<small>${escape(r.detail)}</small>` : ''}</td><td class="num">${escape(r.quantity)}</td><td class="num">${escape(r.rate)}</td><td class="num">${escape(r.amount)}</td></tr>`).join('')}</tbody></table>`).join('')
    : '<p>Nothing to supply yet.</p>';
  const body = `${doc.chip ? `<span class="pill">${escape(doc.chip)}</span>` : ''}
<section class="parties">${party('From', doc.from)}${party('Prepared for', doc.to)}</section>
${factsHtml(doc.facts)}
${sections}
<section class="totals">${doc.totals.map(t => `<div class="row sub"><span>${escape(t.label)}</span><span class="num">${escape(t.value)}</span></div>`).join('')}<div class="row grand"><span>Total</span><span class="num">${escape(doc.total)}</span></div></section>
${doc.notes ? `<section class="block"><h2>Notes</h2><p>${multiline(doc.notes)}</p></section>` : ''}
<section class="block"><h2>Terms</h2><p>${escape(doc.terms)}</p></section>`;
  return page(doc.title, doc.number, doc.footer, origin, body);
}

// The shopping list for the team: by supplier (or by room), with the cost cap, the link, a tick box and the actual spend.
export function shoppingListHtml(q: Pick<QuoteDocInput, 'number' | 'clientName' | 'where' | 'estimateOn' | 'lines' | 'totals'>, options: { origin?: string; by?: 'supplier' | 'room' } = {}) {
  const origin = (options.origin ?? 'https://app.rechargegroup.co.uk').replace(/\/$/, ''), groups = shoppingGroups(q.lines, options.by ?? 'supplier');
  const footer = `${groupTradingName} · Shopping list · ${q.number}`;
  const head = '<tr><th class="box"></th><th>Item</th><th class="num">Buy</th><th class="num">Cap each</th><th class="num">Estimate</th><th class="num">Actual</th></tr>';
  const rows = (lines: readonly EstimateLine[]) => lines.map(l => {
    const link = safeLink(l.productUrl);
    const detail = [options.by === 'room' ? (l.supplier || 'No supplier yet') : categoryName(l.category), l.unit !== 'each' ? l.unit : '', l.existingUnits ? `${l.existingUnits} already there` : ''].filter(Boolean).join(' · ');
    return `<tr><td class="box"><span>${l.purchased ? '&#10003;' : ''}</span></td><td>${escape(l.name)}<small>${escape(detail)}</small>${link ? `<small><a href="${escape(link)}">${escape(link)}</a></small>` : ''}</td>`
      + `<td class="num">${l.packs}</td><td class="num">${escape(docMoney(l.unitCostPence))}</td><td class="num">${escape(docMoney(l.costPence))}</td><td class="num">${l.actualPence != null ? escape(docMoney(l.actualPence)) : ''}</td></tr>`;
  }).join('');
  const body = `<section class="parties">${party('Project', { name: q.clientName, lines: [q.where] })}${party('Prepared', { name: docDay(q.estimateOn), lines: [`${q.totals.toPurchase} retail units on ${q.totals.shoppingLines} lines`] })}</section>
${groups.length ? groups.map(g => `<h3>${escape(g.title)} · ${escape(docMoney(g.costPence))}</h3><table><thead>${head}</thead><tbody>${rows(g.lines)}</tbody></table>`).join('') : '<p>Nothing to buy.</p>'}
<section class="totals"><div class="row sub"><span>Lines with a product link</span><span class="num">${q.totals.linkedLines} of ${q.totals.shoppingLines}</span></div><div class="row grand"><span>Maximum estimate</span><span class="num">${escape(docMoney(q.totals.estimatePence))}</span></div></section>`;
  return page('Shopping list', q.number, footer, origin, body);
}
