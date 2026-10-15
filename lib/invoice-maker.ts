import { z } from 'zod';
import { addDays, DEFAULT_TERMS, INVOICE_DUE_DAYS, type DocCurrency, type DocKind, type RechargeInvoice } from './recharge-invoice';

// The invoice maker (migration 20261022100000): Accounts, admins and super admins make an Invoice (Recharge bills someone) or
// a Request for Invoice (Recharge asks someone to invoice us) from scratch, save it as a draft, issue it (locked, numbered
// RC-INV-YYYY-NNNN or RC-RFI-YYYY-NNNN), then mark it paid or void it, and send it: in the app to someone with an account,
// by email from ownerrelations@ (never to a cleaner), or downloaded to share. This file holds the requests (checked again
// by the database), the form and its maths, the preview, and the lists. The document is lib/recharge-invoice.ts.

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date as year-month-day');
const version = z.number().int().positive();
export const DOC_KINDS = ['invoice', 'request'] as const;
export const DOC_CURRENCIES = ['GBP', 'USD'] as const;
export const MAKER_STATUSES = ['draft', 'issued', 'paid', 'void'] as const;
export type MakerStatus = (typeof MAKER_STATUSES)[number];
export const SEND_CHANNELS = ['in_app', 'email', 'download'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];
export const MAX_LINES = 100;

// --- Requests (the Documents route, lib/invoice-maker-server.ts) ---------------------------------------------------
export const documentsReadSchema = z.object({ section: z.enum(['documents', 'document', 'invoice', 'mine', 'recipients']), id: id.optional() }).strict()
  .superRefine((v, ctx) => { if ((v.section === 'document' || v.section === 'invoice') !== !!v.id) ctx.addIssue({ code: 'custom', message: 'Choose a document' }); });
const lineInput = z.object({ description: z.string().trim().min(1, 'Describe each line').max(500), quantity: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'Check the quantity'), rateMinor: z.number().int().min(0).max(100000000) }).strict();
export const documentsActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('saveDocumentDraft'), requestId: id, id: id.optional(), version: version.optional(), kind: z.enum(DOC_KINDS),
    recipientId: id.optional(), recipientName: z.string().trim().max(200).optional(), recipientEmail: z.string().trim().email('Check the email address').max(320).optional(),
    recipientAddress: z.string().trim().max(500).optional(), currency: z.enum(DOC_CURRENCIES), issueOn: day, dueOn: day,
    periodStart: day.optional(), periodEnd: day.optional(), note: z.string().trim().max(2000), terms: z.string().trim().max(2000), lines: z.array(lineInput).max(MAX_LINES),
  }).strict(),
  z.object({ action: z.literal('issueDocument'), requestId: id, id, version }).strict(),
  z.object({ action: z.literal('markDocumentPaid'), requestId: id, id, version, paidOn: day }).strict(),
  z.object({ action: z.literal('voidDocument'), requestId: id, id, version, reason: z.string().trim().min(5, 'Say why it is void').max(1000) }).strict(),
  z.object({ action: z.literal('sendDocument'), requestId: id, id, channel: z.enum(SEND_CHANNELS) }).strict(),
]);
export type DocumentsAction = z.infer<typeof documentsActionSchema>;
export const documentsQuery = () => ({ section: 'documents' });
export const documentQuery = (documentId: string) => ({ section: 'document', id: documentId });
export const ownerInvoiceQuery = (invoiceId: string) => ({ section: 'invoice', id: invoiceId });
export const mineQuery = () => ({ section: 'mine' });
export const recipientsQuery = () => ({ section: 'recipients' });

// --- What the database returns -------------------------------------------------------------------------------------
export const makerLineSchema = z.object({ position: z.number(), description: z.string(), quantity: z.union([z.number(), z.string()]), rateMinor: z.number(), amountMinor: z.number() });
export const makerDocumentSchema = z.object({
  source: z.literal('maker'), id, kind: z.enum(DOC_KINDS), status: z.enum(MAKER_STATUSES), number: z.string().nullable(),
  recipient: z.object({ userId: id.nullable(), name: z.string(), address: z.string(), email: z.string().nullable().optional(), role: z.string().nullable().optional(), hasEmail: z.boolean().nullable().optional() }),
  currency: z.enum(DOC_CURRENCIES), issueOn: day, dueOn: day, periodStart: day.nullable(), periodEnd: day.nullable(), note: z.string(), terms: z.string(),
  totalMinor: z.number(), paidOn: day.nullable(), voidReason: z.string().nullable(), version: z.number(), createdAt: z.string(), updatedAt: z.string(), issuedAt: z.string().nullable(),
  lineCount: z.number(), lastSentAt: z.string().nullable(),
  lines: z.array(makerLineSchema).optional(),
  history: z.array(z.object({ action: z.string(), fromStatus: z.string().nullable(), toStatus: z.string().nullable(), version: z.number(), at: z.string(), by: z.string().nullable(), detail: z.record(z.string(), z.unknown()).optional() })).optional(),
  sends: z.array(z.object({ channel: z.enum(SEND_CHANNELS), toName: z.string(), toEmail: z.string().nullable(), status: z.enum(['pending', 'sent', 'failed']), at: z.string(), by: z.string().nullable() })).optional(),
});
export type MakerDocument = z.infer<typeof makerDocumentSchema>;
export const makerDocumentsSchema = z.array(makerDocumentSchema);
export const workspaceInvoiceDocSchema = z.object({
  source: z.literal('workspace'), id, module: z.string(), reference: z.string(), status: z.string(), issueOn: day, paidOn: day.nullable(), amountMinor: z.number(), currency: z.string(),
  version: z.number(), recipientName: z.string(), propertyName: z.string().nullable(), propertyAddress: z.string().nullable(), workTitle: z.string().nullable(),
  stay: z.object({ reference: z.string().nullable(), checkIn: day, checkOut: day }).nullable(),
});
export const mineSchema = z.object({ documents: makerDocumentsSchema, invoices: z.array(workspaceInvoiceDocSchema) });
export const recipientSchema = z.object({ userId: id, name: z.string(), role: z.string(), canEmail: z.boolean() });
export const recipientsSchema = z.array(recipientSchema);
export type Recipient = z.infer<typeof recipientSchema>;

// --- The form and its maths ------------------------------------------------------------------------------------------
export type FormLine = { key: string; description: string; quantity: string; rate: string };
export type MakerForm = {
  kind: DocKind; recipientId: string; recipientName: string; recipientEmail: string; recipientAddress: string; currency: DocCurrency;
  issueOn: string; dueOn: string; periodStart: string; periodEnd: string; note: string; terms: string; termsEdited: boolean; lines: FormLine[];
};
let lineSeq = 0;
export const newLine = (over: Partial<FormLine> = {}): FormLine => ({ key: `line-${++lineSeq}`, description: '', quantity: '1', rate: '', ...over });
// Issue date today, due 7 days on, pounds, the default terms for the kind, one empty line.
export function emptyForm(today: string, kind: DocKind = 'invoice'): MakerForm {
  return { kind, recipientId: '', recipientName: '', recipientEmail: '', recipientAddress: '', currency: 'GBP', issueOn: today, dueOn: addDays(today, INVOICE_DUE_DAYS),
    periodStart: '', periodEnd: '', note: '', terms: DEFAULT_TERMS[kind], termsEdited: false, lines: [newLine()] };
}
// Changing the kind swaps the default terms, unless they were edited for this document.
export const withKind = (f: MakerForm, kind: DocKind): MakerForm => ({ ...f, kind, terms: f.termsEdited ? f.terms : DEFAULT_TERMS[kind] });
// A new issue date moves the due date with it while the due date is still the default.
export const withIssueOn = (f: MakerForm, issueOn: string): MakerForm => ({ ...f, issueOn, dueOn: !f.dueOn || f.dueOn === addDays(f.issueOn, INVOICE_DUE_DAYS) ? addDays(issueOn, INVOICE_DUE_DAYS) : f.dueOn });
export const addLine = (lines: readonly FormLine[]) => lines.length >= MAX_LINES ? [...lines] : [...lines, newLine()];
export const removeLine = (lines: readonly FormLine[], key: string) => lines.filter(l => l.key !== key);
// Up (-1) or down (+1) one place.
export function moveLine(lines: readonly FormLine[], key: string, by: -1 | 1) {
  const from = lines.findIndex(l => l.key === key), to = from + by, next = [...lines];
  if (from < 0 || to < 0 || to >= lines.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// "1", "1.5", "2.25": hundredths, or null.
export function quantityHundredths(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const value = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return value > 0 && value <= 10_000_000 ? value : null;
}
// "45", "45.5", "£1,250.00", "$80": pence or cents, or null.
export function rateMinor(text: string): number | null {
  const t = text.trim().replace(/^[£$]/, '').replace(/,/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const value = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return value <= 100_000_000 ? value : null;
}
const quantityText = (hundredths: number) => (hundredths % 100 === 0 ? String(hundredths / 100) : (hundredths / 100).toFixed(hundredths % 10 === 0 ? 1 : 2));
// Quantity times rate, rounded to the penny with halves away from zero, in whole numbers only (the database does the same:
// round(quantity * rate) on numeric). 1.5 x 3333 = 4999.5, so 5000.
export const lineAmountMinor = (hundredths: number, rate: number) => Math.floor((hundredths * rate + 50) / 100);
export type FormMaths = { lines: { key: string; amountMinor: number | null }[]; subtotalMinor: number; totalMinor: number; complete: boolean };
export function formMaths(lines: readonly FormLine[]): FormMaths {
  const out = lines.map(l => { const q = quantityHundredths(l.quantity), r = rateMinor(l.rate); return { key: l.key, amountMinor: q !== null && r !== null ? lineAmountMinor(q, r) : null }; });
  const subtotalMinor = out.reduce((t, l) => t + (l.amountMinor ?? 0), 0);
  return { lines: out, subtotalMinor, totalMinor: subtotalMinor, complete: out.every(l => l.amountMinor !== null) };
}

type SaveAction = Extract<DocumentsAction, { action: 'saveDocumentDraft' }>;
// The form as a Save draft request, or the first thing to fix. A line left completely empty is dropped.
export function formToAction(f: MakerForm, requestId: string, editing?: { id: string; version: number }): { action: SaveAction } | { error: string } {
  const typed = !f.recipientId;
  if (typed && f.recipientName.trim().length < 2) return { error: 'Choose who it is for, or type their name.' };
  if (typed && f.recipientEmail.trim() && !z.string().email().safeParse(f.recipientEmail.trim()).success) return { error: 'Check the email address.' };
  if (!day.safeParse(f.issueOn).success || !day.safeParse(f.dueOn).success) return { error: 'Choose the issue date and the due date.' };
  if (f.dueOn < f.issueOn) return { error: 'The due date cannot be before the issue date.' };
  if (!!f.periodStart !== !!f.periodEnd || (f.periodStart && f.periodEnd < f.periodStart)) return { error: 'Give the period a start and an end, in order, or leave both empty.' };
  const used = f.lines.filter(l => l.description.trim() || l.rate.trim());
  const lines: SaveAction['lines'] = [];
  for (const [n, l] of used.entries()) {
    const q = quantityHundredths(l.quantity), r = rateMinor(l.rate);
    if (!l.description.trim()) return { error: `Describe line ${n + 1}.` };
    if (q === null) return { error: `Check the quantity on line ${n + 1}, for example 1 or 2.5.` };
    if (r === null) return { error: `Check the rate on line ${n + 1}, for example 45.00.` };
    lines.push({ description: l.description.trim(), quantity: quantityText(q), rateMinor: r });
  }
  return { action: {
    action: 'saveDocumentDraft', requestId, ...(editing ? { id: editing.id, version: editing.version } : {}), kind: f.kind,
    ...(typed ? { recipientName: f.recipientName.trim(), ...(f.recipientEmail.trim() ? { recipientEmail: f.recipientEmail.trim() } : {}) } : { recipientId: f.recipientId, recipientName: f.recipientName.trim() || undefined }),
    recipientAddress: f.recipientAddress.trim(), currency: f.currency, issueOn: f.issueOn, dueOn: f.dueOn,
    ...(f.periodStart && f.periodEnd ? { periodStart: f.periodStart, periodEnd: f.periodEnd } : {}), note: f.note.trim(), terms: f.terms.trim(), lines,
  } };
}
// A saved draft back in the form, to edit.
export function formFromDocument(d: MakerDocument): MakerForm {
  return {
    kind: d.kind, recipientId: d.recipient.userId ?? '', recipientName: d.recipient.name, recipientEmail: d.recipient.userId ? '' : d.recipient.email ?? '', recipientAddress: d.recipient.address,
    currency: d.currency, issueOn: d.issueOn, dueOn: d.dueOn, periodStart: d.periodStart ?? '', periodEnd: d.periodEnd ?? '', note: d.note, terms: d.terms,
    termsEdited: d.terms !== DEFAULT_TERMS[d.kind], lines: (d.lines ?? []).map(l => newLine({ description: l.description, quantity: String(Number(l.quantity)), rate: (l.rateMinor / 100).toFixed(2) })),
  };
}
const addressLines = (address: string) => address.split(/\r?\n|,\s*/).map(s => s.trim()).filter(Boolean);
// The live preview: the form as the branded document, a draft until issued.
export function formToInvoice(f: MakerForm): RechargeInvoice {
  const maths = formMaths(f.lines);
  return {
    kind: f.kind, number: null, status: 'draft', currency: f.currency,
    billedTo: { name: f.recipientName, lines: [...addressLines(f.recipientAddress), !f.recipientId ? f.recipientEmail.trim() : ''].filter(Boolean) },
    issueOn: f.issueOn || null, dueOn: f.dueOn || null, periodStart: f.periodStart || null, periodEnd: f.periodEnd || null,
    lines: f.lines.filter(l => l.description.trim() || l.rate.trim()).map(l => {
      const q = quantityHundredths(l.quantity);
      return { description: l.description.trim() || 'Line', quantity: q !== null ? quantityText(q) : l.quantity.trim(), rateMinor: rateMinor(l.rate), amountMinor: maths.lines.find(m => m.key === l.key)?.amountMinor ?? 0 };
    }),
    note: f.note, terms: f.terms,
  };
}
// A saved document as the branded document.
export function fromMakerDocument(d: MakerDocument): RechargeInvoice {
  return {
    kind: d.kind, number: d.number, status: d.status, currency: d.currency,
    billedTo: { name: d.recipient.name, lines: [...addressLines(d.recipient.address), !d.recipient.userId && d.recipient.email ? d.recipient.email : ''].filter(Boolean) },
    issueOn: d.issueOn, dueOn: d.dueOn, periodStart: d.periodStart, periodEnd: d.periodEnd, paidOn: d.paidOn, voidReason: d.voidReason,
    lines: (d.lines ?? []).map(l => ({ description: l.description, quantity: quantityText(Math.round(Number(l.quantity) * 100)), rateMinor: l.rateMinor, amountMinor: l.amountMinor })),
    note: d.note, terms: d.terms,
  };
}

// --- The list --------------------------------------------------------------------------------------------------------
export const STATUS_LABEL: Record<MakerStatus, string> = { draft: 'Drafts', issued: 'Issued', paid: 'Paid', void: 'Void' };
export const KIND_LABEL: Record<DocKind, string> = { invoice: 'Invoice', request: 'Request for invoice' };
const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
// One status, then every word typed in the recipient's name or the number.
export function filterDocuments(docs: readonly MakerDocument[], status: MakerStatus, query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return docs.filter(d => d.status === status && words.every(w => fold(`${d.recipient.name} ${d.number ?? ''}`).includes(w)));
}
export const statusCounts = (docs: readonly MakerDocument[]) => Object.fromEntries(MAKER_STATUSES.map(s => [s, docs.filter(d => d.status === s).length])) as Record<MakerStatus, number>;

// How an issued document can go out: in the app to someone with an account; by email to anyone with an address who is not
// a cleaner (cleaners use the app on their phone and are never emailed); downloaded always.
export function sendChoices(d: Pick<MakerDocument, 'status' | 'recipient'>): SendChannel[] {
  if (d.status !== 'issued' && d.status !== 'paid') return [];
  const cleaner = d.recipient.role === 'cleans';
  return [...(d.recipient.userId ? ['in_app' as const] : []), ...(!cleaner && (d.recipient.hasEmail || !!d.recipient.email) ? ['email' as const] : []), 'download' as const];
}
export const SEND_LABEL: Record<SendChannel, string> = { in_app: 'Send in the app', email: 'Email it', download: 'Download to share' };
export const HISTORY_LABEL: Record<string, string> = {
  created: 'Draft started', saved: 'Draft saved', issued: 'Issued', paid: 'Marked paid', voided: 'Voided', sent_in_app: 'Sent in the app',
  email_started: 'Email started', emailed: 'Emailed', email_failed: 'Email not sent', downloaded: 'Downloaded to share',
};
