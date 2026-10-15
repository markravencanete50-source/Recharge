import { z } from 'zod';
import { brandCanvas, darkBrandCanvas, depthTokens, designTokens } from './design-tokens';
import { formatMoney } from './format';
import { legalDetails } from './legal-details';

// Requests for invoice (migration 20261022000000). At the end of each pay period (weekly, Monday to Sunday, or monthly)
// each cleaner's accepted cleans become one request for invoice, RC-RFI-YYYY-NNNN, "To approve": Recharge asks the cleaner
// to invoice us for the amount. Each clean has an outcome (Completed, Partially successful at half the rate, Unsuccessful
// at nothing) that management or the cleaning manager can change while the request waits. Accounts approve it (or query
// it with a note to the cleaner), then mark it paid with the date. The cleaner sees their earnings, what is waiting to be
// paid and what is projected, and every request opens as the same designed document on screen and as a print-ready page
// (save as PDF from the browser's print). This file holds the shapes the database returns, the requests the screens send,
// the Accounts groupings, and the document itself (one view model drawn by the app and by the HTML page). Code names keep
// "invoice"; the words people read say "request for invoice".

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const PAY_PERIODS = ['weekly', 'monthly'] as const;
export type PayPeriod = (typeof PAY_PERIODS)[number];
export const INVOICE_STATUSES = ['to_approve', 'approved', 'paid', 'rejected'] as const;
export type PayInvoiceStatus = (typeof INVOICE_STATUSES)[number];

// Each clean's outcome on a request. None set counts as completed.
export const CLEAN_OUTCOMES = ['completed', 'partial', 'unsuccessful'] as const;
export type CleanOutcome = (typeof CLEAN_OUTCOMES)[number];
export const OUTCOME_LABEL: Record<CleanOutcome, string> = { completed: 'Completed', partial: 'Partially successful', unsuccessful: 'Unsuccessful' };
// What a clean earns for its outcome, in pence. The same rule as private.workspace_clean_outcome_minor: the full rate,
// half the rate rounded to the penny with half a penny going up ((rate + 1) / 2 in whole pence: £45.25 gives £22.63), or 0.
export const outcomeMinor = (rateMinor: number, outcome: CleanOutcome | null | undefined) =>
  outcome === 'partial' ? Math.floor((rateMinor + 1) / 2) : outcome === 'unsuccessful' ? 0 : rateMinor;

// Who set a clean's outcome (migration 20261022050000): the request itself from the app's flags ('auto') or a person
// ('manual'); none when nobody has. A person's choice is never changed by the flags again.
export const OUTCOME_SOURCES = ['auto', 'manual'] as const;
// Why the request set an outcome itself, in the words shown after "Auto:" and in the history.
// late_redo_accepted and late_dispute_won: a follow-up line on a later request for a clean that was Unsuccessful at £0 on an
// approved request, then redone or its dispute won (followsNumber is that request).
export const AUTO_REASONS = ['no_form', 'rejected', 'redo_accepted', 'dispute_won', 'form_in', 'cleared', 'late_redo_accepted', 'late_dispute_won'] as const;
export type AutoReason = (typeof AUTO_REASONS)[number];
export const AUTO_REASON_LABEL: Record<AutoReason, string> = {
  no_form: 'no clean form', rejected: 'rejected and not redone', redo_accepted: 'redo accepted after rejection',
  dispute_won: "dispute decided in the cleaner's favour", form_in: 'clean form arrived late', cleared: 'flag cleared',
  late_redo_accepted: 'redo accepted after the earlier request was approved', late_dispute_won: 'dispute won after the earlier request was approved',
};
// The reason in words, naming the earlier request for a late redo or dispute: "redo accepted after RC-RFI-2026-0007 was approved".
export function autoReasonText(reason: AutoReason, earlier?: string | null) {
  if (earlier && reason === 'late_redo_accepted') return `redo accepted after ${earlier} was approved`;
  if (earlier && reason === 'late_dispute_won') return `dispute won after ${earlier} was approved`;
  return AUTO_REASON_LABEL[reason];
}

// amountMinor is what the clean earns at its outcome; rateMinor its snapshot rate.
export const payInvoiceLineSchema = z.object({
  workId: id, cleanOn: day.nullable(), propertyName: z.string(), amountMinor: z.number().int(),
  rateMinor: z.number().int().optional(), outcome: z.enum(CLEAN_OUTCOMES).nullable().optional(),
  outcomeSource: z.enum(OUTCOME_SOURCES).nullable().optional(), outcomeReason: z.enum(AUTO_REASONS).nullable().optional(),
  followsNumber: z.string().nullable().optional(),
});
export const payHistorySchema = z.object({
  at: z.string(), event: z.enum(['issued', 'outcome', 'queried', 'approved', 'paid']), actorName: z.string().nullable(), workId: id.nullable().optional(),
  from: z.enum(CLEAN_OUTCOMES).optional(), to: z.enum(CLEAN_OUTCOMES).optional(), amountMinor: z.number().optional(), totalMinor: z.number().optional(),
  propertyName: z.string().nullable().optional(), cleanOn: day.nullable().optional(), note: z.string().optional(), paidOn: day.optional(), cleans: z.number().optional(),
  auto: z.boolean().optional(), reason: z.enum(AUTO_REASONS).optional(), afterNumber: z.string().nullable().optional(),
});
export type PayHistory = z.infer<typeof payHistorySchema>;
export const payInvoiceSchema = z.object({
  id, number: z.string(), reference: z.string(), generated: z.boolean(),
  cleanerId: id.nullable(), cleanerName: z.string(), supplier: z.string(),
  status: z.enum(INVOICE_STATUSES), queried: z.boolean(), queryNote: z.string().nullable(), queriedAt: z.string().nullable(),
  issueOn: day, periodKind: z.enum(PAY_PERIODS).nullable(), periodStart: day.nullable(), periodEnd: day.nullable(), dueOn: day,
  approvedAt: z.string().nullable(), paidOn: day.nullable(), totalMinor: z.number().int(), currency: z.literal('GBP'), version: z.number().int(), lineCount: z.number().int(),
  lines: z.array(payInvoiceLineSchema).optional(), history: z.array(payHistorySchema).optional(),
});
export type PayInvoice = z.infer<typeof payInvoiceSchema>;
export type PayInvoiceLine = z.infer<typeof payInvoiceLineSchema>;
export const lineOutcome = (l: Pick<PayInvoiceLine, 'outcome'>): CleanOutcome => l.outcome ?? 'completed';
export const lineRate = (l: Pick<PayInvoiceLine, 'rateMinor' | 'amountMinor'>) => l.rateMinor ?? l.amountMinor;
// Under the outcome in the app's request sheet (never on the printed document): "Auto: no clean form".
export const autoOutcomeNote = (l: Pick<PayInvoiceLine, 'outcomeSource' | 'outcomeReason' | 'followsNumber'>) =>
  l.outcomeSource === 'auto' && l.outcomeReason ? `Auto: ${autoReasonText(l.outcomeReason, l.followsNumber)}` : '';
// On the document too, after the outcome note: a follow-up for a late redo or dispute names the earlier request.
export function lateNote(l: Pick<PayInvoiceLine, 'outcomeReason' | 'followsNumber'>) {
  if (!l.followsNumber) return '';
  if (l.outcomeReason === 'late_redo_accepted') return `Late redo, see ${l.followsNumber}`;
  if (l.outcomeReason === 'late_dispute_won') return `Late dispute, see ${l.followsNumber}`;
  return '';
}
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
// A clean's outcome on a request waiting for approval: management and the cleaner's cleaning manager.
export const outcomeAction = (i: { requestId: string; invoice: Pick<PayInvoice, 'id' | 'version'>; workId: string; outcome: CleanOutcome }) => ({ action: 'setPayLineOutcome' as const, requestId: i.requestId, invoiceId: i.invoice.id, workId: i.workId, outcome: i.outcome, version: i.invoice.version });
export const PAY_ACTIONS = ['approvePayInvoice', 'queryPayInvoice', 'markPayInvoicePaid', 'setCleanerPayPeriod', 'setPayLineOutcome'] as const;

// --- Dates and money, written one way everywhere on the request --------------------------------------------------
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
// The status in words: "To approve", "Approved" or "Paid (date)" (lists and screen readers).
export const statusLine = (i: Pick<PayInvoice, 'status' | 'paidOn' | 'queried'>) => i.status === 'paid' && i.paidOn ? `Paid (${longDay(i.paidOn)})` : statusOf({ ...i, queried: false }).label;

// --- The request for invoice document ----------------------------------------------------------------------------
// Who the request is from. Lee is confirming which name goes where: this is the one place to change it. The address and
// the company come from lib/legal-details.ts, never a second copy.
export const RECHARGE_PARTY = {
  name: 'Recharge Group',
  lines: [legalDetails.registeredAddress, `${legalDetails.legalName} · Company no. ${legalDetails.companyNumber}`],
} as const;
// The terms near the bottom. Lee may replace this text; {number} becomes the request's number. "Within 7 days" is the
// database's rule: a request is due 7 days after it is issued (PAY_WITHIN_DAYS).
export const PAY_WITHIN_DAYS = 7;
export const REQUEST_TERMS = 'Please send us your invoice for the amount above, quoting reference {number}. We pay valid invoices within 7 days.';
export const requestTerms = (number: string) => REQUEST_TERMS.split('{number}').join(number);
export const THANK_YOU = 'Thank you for keeping our homes guest-ready.';
export const AMOUNT_LABEL = 'Amount to invoice';
export type InvoiceFact = { label: string; value: string };
// The chip on the document, only while the request is not paid: "Awaiting approval" or "Due Tue 20 Oct". A paid request
// says so with the PAID stamp and the "Paid on" fact instead.
export type InvoiceChip = { label: string; tone: StatusTone };
export function invoiceChip(i: Pick<PayInvoice, 'status' | 'queried' | 'dueOn'>): InvoiceChip | null {
  if (i.status === 'paid') return null;
  if (i.status === 'approved') return { label: `Due ${shortDay(i.dueOn)}`, tone: 'good' };
  if (i.status === 'rejected') return { label: 'Rejected', tone: 'bad' };
  return { label: i.queried ? 'Awaiting approval · queried' : 'Awaiting approval', tone: 'wait' };
}
export type InvoiceDocLine = { key: string; date: string; property: string; outcome: CleanOutcome; outcomeLabel: string; outcomeNote: string; amount: string };
export type InvoiceDoc = {
  title: 'Request for invoice'; heading: 'REQUEST FOR INVOICE'; number: string; status: { label: string; tone: StatusTone; line: string }; chip: InvoiceChip | null; paidStamp: string | null;
  from: { name: string; lines: readonly string[] }; to: string; facts: InvoiceFact[]; lines: InvoiceDocLine[]; count: number;
  fullRate: string; adjustment: string | null; total: string; totalLabel: typeof AMOUNT_LABEL; terms: string; thanks: string; footer: string;
};
// What the outcome cell says under its label: nothing for a completed clean, the full rate otherwise.
const outcomeNote = (outcome: CleanOutcome, rate: number) => outcome === 'partial' ? `Half of ${money(rate)}` : outcome === 'unsuccessful' ? `Rate ${money(rate)}, not paid` : '';
// Everything the document shows, empty fields left out (never placeholder text).
export function invoiceDoc(i: PayInvoice): InvoiceDoc {
  const raw = i.lines ?? [];
  const lines = raw.map(l => ({ key: l.workId, date: l.cleanOn ? shortDay(l.cleanOn) : '', property: l.propertyName, outcome: lineOutcome(l), outcomeLabel: OUTCOME_LABEL[lineOutcome(l)],
    outcomeNote: [outcomeNote(lineOutcome(l), lineRate(l)), lateNote(l)].filter(Boolean).join(' · '), amount: money(l.amountMinor) }));
  const full = raw.reduce((t, l) => t + lineRate(l), 0), earned = raw.reduce((t, l) => t + l.amountMinor, 0);
  const s = statusOf(i), paid = i.status === 'paid';
  const facts: InvoiceFact[] = [
    { label: 'Issue date', value: longDay(i.issueOn) },
    { label: 'Period', value: periodLabel(i.periodStart, i.periodEnd, i.periodKind) ?? '' },
    { label: 'Cleans', value: String(i.lines?.length ?? i.lineCount) },
    paid ? { label: 'Paid on', value: i.paidOn ? longDay(i.paidOn) : '' } : { label: 'Due date', value: i.status === 'rejected' ? '' : longDay(i.dueOn) },
  ].filter(f => f.value);
  return {
    title: 'Request for invoice', heading: 'REQUEST FOR INVOICE', number: i.number, status: { ...s, line: statusLine(i) }, chip: invoiceChip(i),
    paidStamp: paid && i.paidOn ? `Paid ${longDay(i.paidOn)}` : paid ? 'Paid' : null,
    from: RECHARGE_PARTY, to: i.cleanerName || i.supplier, facts, lines, count: lines.length || i.lineCount,
    fullRate: money(raw.length ? full : i.totalMinor), adjustment: raw.length && full !== earned ? `−${money(full - earned)}` : null,
    total: money(i.totalMinor), totalLabel: AMOUNT_LABEL, terms: requestTerms(i.number), thanks: THANK_YOU, footer: `${RECHARGE_PARTY.name} · ${i.number}`,
  };
}
export const invoiceFileName = (i: Pick<PayInvoice, 'number'>) => `Request-for-invoice-${i.number.replace(/[^A-Za-z0-9-]+/g, '-')}.html`;

// The history under the document: who did what, in words.
export function historyLine(h: PayHistory) {
  const who = h.actorName ?? 'Recharge';
  const clean = [h.propertyName, h.cleanOn ? shortDay(h.cleanOn) : ''].filter(Boolean).join(', ') || 'A clean';
  switch (h.event) {
    case 'issued': return `Issued${h.cleans != null ? ` for ${h.cleans} clean${h.cleans === 1 ? '' : 's'}` : ''}${h.totalMinor != null ? `, ${money(h.totalMinor)}` : ''}`;
    case 'outcome': {
      const was = `${h.from ? ` (was ${OUTCOME_LABEL[h.from]})` : ''}${h.totalMinor != null ? `. ${AMOUNT_LABEL} now ${money(h.totalMinor)}` : ''}`;
      // Set by the request from the app's flags: "Set 12 Leith St, Wed 7 Oct to Unsuccessful automatically: no clean form".
      if (h.auto) return `Set ${clean} to ${OUTCOME_LABEL[h.to ?? 'completed']} automatically${h.reason ? `: ${autoReasonText(h.reason, h.afterNumber)}` : ''}${was}`;
      return `${who} set ${clean} to ${OUTCOME_LABEL[h.to ?? 'completed']}${was}`;
    }
    case 'queried': return `${who} queried it${h.note ? `: ${h.note}` : ''}`;
    case 'approved': return `${who} approved it${h.totalMinor != null ? ` at ${money(h.totalMinor)}` : ''}`;
    case 'paid': return `${who} marked it paid${h.paidOn ? ` on ${longDay(h.paidOn)}` : ''}`;
  }
}
// The London day of a moment, "Mon 6 Oct 2026".
export function historyDay(at: string) {
  try { return longDay(new Date(at).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })); } catch { return longDay(at.slice(0, 10)); }
}

// The document's colours, all from the app's light theme (paper is always light, also in dark mode and in print).
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
// layout, never by editing the file, and the document does the same: width, height and offsets for a given width.
export const LOGO_FILE = 'recharge-company-logo.png';
export const logoBox = (width: number) => { const s = width / 1900; return { width, height: Math.round(400 * s), imageWidth: Math.round(2171 * s), imageHeight: Math.round(724 * s), left: -Math.round(105 * s), top: -Math.round(110 * s) }; };

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// The request as a page: A4 portrait, one page for a usual request; a long one runs on with the table header repeated
// and "page X of Y" in the footer of each page. Vector text, so the PDF saved from print is crisp. `origin` is where the
// logo and the Montserrat files are served (the app's own site; a file:// folder for the sample).
export function invoiceHtml(i: PayInvoice, options: { origin?: string } = {}) {
  const doc = invoiceDoc(i), origin = (options.origin ?? 'https://app.rechargegroup.co.uk').replace(/\/$/, ''), c = INVOICE_PAPER, tone = c.tone[doc.chip?.tone ?? doc.status.tone], logo = logoBox(188);
  const font = (weight: number) => `@font-face{font-family:"Montserrat";font-weight:${weight};font-style:normal;src:url("${origin}/fonts/montserrat-${weight}.ttf") format("truetype")}`;
  const facts = doc.facts.map(f => `<div class="fact"><dt>${escape(f.label)}</dt><dd>${escape(f.value)}</dd></div>`).join('');
  const rows = doc.lines.map(l => `<tr class="${l.outcome}"><td class="date">${escape(l.date)}</td><td>${escape(l.property)}</td><td class="outcome"><span class="label">${escape(l.outcomeLabel)}</span>${l.outcomeNote ? `<span class="note">${escape(l.outcomeNote)}</span>` : ''}</td><td class="num">${escape(l.amount)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Request for invoice ${escape(doc.number)} · ${escape(doc.to)}</title>
<style>${font(400)}${font(600)}
@page{size:A4 portrait;margin:16mm 16mm 20mm;@bottom-left{content:"${escape(doc.footer)}";font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}@bottom-right{content:"Page " counter(page) " of " counter(pages);font:400 8pt "Montserrat",Helvetica,Arial,sans-serif;color:${c.muted}}}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-scheme:light}
body{margin:0;background:${c.band};color:${c.ink};font:400 10pt/1.5 "Montserrat",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
.sheet{max-width:794px;margin:24px auto;background:${c.page};border-radius:14px;overflow:hidden;box-shadow:${depthTokens.light['elev-2']}}
.band{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:28px 40px;background:${c.band};border-bottom:1px solid ${c.rule}}
.logo{position:relative;width:${logo.width}px;height:${logo.height}px;overflow:hidden;flex:none}.logo img{position:absolute;width:${logo.imageWidth}px;height:${logo.imageHeight}px;left:${logo.left}px;top:${logo.top}px}
.title{text-align:right}.word{font-weight:600;font-size:15pt;letter-spacing:.24em;margin-right:-.24em;color:${c.forest};line-height:1.2}.number{margin-top:6px;font-size:10.5pt;letter-spacing:.06em;color:${c.muted}}
.body{padding:28px 40px 36px;position:relative}
.status{display:flex;align-items:center;gap:12px;margin:0 0 26px}.pill{display:inline-block;padding:5px 14px;border-radius:999px;background:${tone.wash};color:${tone.ink};font-weight:600;font-size:9pt;letter-spacing:.02em}
.stamp{position:absolute;right:46px;top:${doc.chip ? 96 : 20}px;transform:rotate(-8deg);border:2px solid ${c.forest};color:${c.forest};border-radius:10px;padding:8px 16px;text-align:center;opacity:.78;font-weight:600;letter-spacing:.24em;font-size:15pt;line-height:1.1;background:${c.page}}
.stamp small{display:block;letter-spacing:.06em;font-size:8pt;font-weight:400;margin-top:4px}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:22px}
h2{margin:0 0 4px;font-size:8pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${c.muted}}.party p{margin:0}.party .name{font-size:12pt;font-weight:600}.party .line{font-size:9pt;color:${c.muted}}
.facts{display:grid;grid-template-columns:repeat(${Math.max(doc.facts.length, 1)},1fr);gap:0;margin:0 0 28px;border-top:1px solid ${c.rule};border-bottom:1px solid ${c.rule}}
.fact{padding:12px 14px 12px 0}.fact+.fact{padding-left:14px;border-left:1px solid ${c.rule}}.fact dt{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};margin-bottom:3px}.fact dd{margin:0;font-size:10pt}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{font-size:7.5pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.muted};text-align:left;padding:0 10px 8px;border-bottom:1px solid ${c.ink}}
td{padding:9px 10px;border-bottom:1px solid ${c.rule};vertical-align:top}tbody tr:nth-child(even) td{background:${c.zebra}}tr{break-inside:avoid}
.date{white-space:nowrap;width:20%}.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}th.num{text-align:right}
.outcome .label{display:block}.outcome .note{display:block;color:${c.muted};font-size:8.5pt}.completed .outcome .label{color:${c.muted}}.partial .outcome .label,.unsuccessful .outcome .label{font-weight:600}
.totals{margin:22px 0 0 auto;width:min(320px,100%);break-inside:avoid}.totals .row{display:flex;justify-content:space-between;gap:16px;padding:6px 10px}.totals .sub{color:${c.muted};border-bottom:1px solid ${c.rule}}
.totals .grand{align-items:baseline;padding-top:12px}.totals .grand span:first-child{font-weight:600;letter-spacing:.04em}.totals .grand span:last-child{font-size:18pt;font-weight:600;color:${c.forest}}
.terms{margin:30px 0 0;padding:14px 16px;border-radius:10px;background:${c.zebra};break-inside:avoid}.terms p{margin:0;font-size:9.5pt}
.thanks{margin:28px 0 0;padding-top:16px;border-top:1px solid ${c.rule};color:${c.muted};font-size:9.5pt;break-inside:avoid}.thanks p{margin:0}.thanks .who{margin-top:4px;font-size:8.5pt}
.print{display:block;margin:0 auto 24px;font:600 10pt "Montserrat",Helvetica,Arial,sans-serif;padding:10px 20px;border-radius:999px;border:1px solid ${c.forest};background:${c.page};color:${c.forest};cursor:pointer}
@media print{html,body{background:${c.page}}.sheet{margin:0;max-width:none;border-radius:0;box-shadow:none;overflow:visible}.print{display:none}.band{padding:20px 22px;border-radius:10px;border-bottom:0}.body{padding:22px 0 0}.stamp{right:6px}.terms{margin-top:22px}.thanks{margin-top:20px}.thanks .who{display:none}}
</style></head>
<body>
<main class="sheet" aria-label="Request for invoice ${escape(doc.number)}">
<header class="band"><div class="logo"><img src="${escape(origin)}/${LOGO_FILE}" alt="Recharge"></div><div class="title"><div class="word">${doc.heading}</div><div class="number">${escape(doc.number)}</div></div></header>
<div class="body">
${doc.chip ? `<div class="status"><span class="pill">${escape(doc.chip.label)}</span></div>` : ''}
${doc.paidStamp ? `<div class="stamp" aria-hidden="true">PAID<small>${escape(doc.paidStamp.replace(/^Paid /, ''))}</small></div>` : ''}
<section class="parties"><div class="party"><h2>From</h2><p class="name">${escape(doc.from.name)}</p>${doc.from.lines.map(l => `<p class="line">${escape(l)}</p>`).join('')}</div><div class="party"><h2>To</h2><p class="name">${escape(doc.to)}</p></div></section>
<dl class="facts">${facts}</dl>
<table><thead><tr><th>Date</th><th>Property</th><th>Outcome</th><th class="num">Rate</th></tr></thead><tbody>${rows}</tbody></table>
<section class="totals"><div class="row sub"><span>${doc.count} clean${doc.count === 1 ? '' : 's'} at full rate</span><span class="num">${escape(doc.fullRate)}</span></div>${doc.adjustment ? `<div class="row sub"><span>Outcome adjustments</span><span class="num">${escape(doc.adjustment)}</span></div>` : ''}<div class="row grand"><span>${doc.totalLabel}</span><span class="num">${escape(doc.total)}</span></div></section>
<section class="terms"><h2>Terms</h2><p>${escape(doc.terms)}</p></section>
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
    waiting: { label: 'Waiting to be paid', value: money(e.waitingMinor), detail: e.waitingCount ? `${e.waitingCount} request${e.waitingCount === 1 ? '' : 's'}: ${money(e.waitingApprovedMinor)} approved, ${money(e.waitingToApproveMinor)} to approve` : 'Nothing waiting' },
    projected: { label: PROJECTED_LABEL, value: money(e.projectedMinor),
      detail: [`${e.acceptedNotInvoicedCount} accepted, not on a request yet`, `${e.upcomingCount} more this ${e.periodKind === 'monthly' ? 'month' : 'week'}${e.rateMinor ? ` at ${money(e.rateMinor)}` : ''}`].join(' · ')
        + (e.unpricedCount ? ` · ${e.unpricedCount} waiting for your rate` : '') },
  };
}
