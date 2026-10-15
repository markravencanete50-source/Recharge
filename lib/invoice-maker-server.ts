import { securityRpc, authSecurityConfiguration } from './auth-security';
import { businessResponse, databaseFailure } from './business-server';
import { documentMailbox, documentsActionSchema, documentsReadSchema, fromMakerDocument, makerDocumentSchema, RECIPIENT_TYPES, type DocumentsAction } from './invoice-maker';
import { docDay, docMoney, fromReceivable, rechargeInvoiceDoc, rechargeInvoiceFileName, rechargeInvoiceHtml, type RechargeInvoice } from './recharge-invoice';
import { receivableItemSchema } from './tracker-receivable';
import { groupTradingName } from './legal-details';
import { documentEmailReady, resendErrorMessage, sendMailboxEmail } from './resend-email';
import { rpcRoute, type RpcContext } from './workspace-rpc-route';
import { z } from 'zod';

// The Documents route: Recharge's invoices and the invoice maker (migration 20261022100000). The database decides who may
// read and do what. Emailing is done here: the database checks the recipient (never a cleaner, never a draft), chooses the
// mailbox and records a pending send; the email goes out from that mailbox with the document attached as an HTML page, and
// the outcome is recorded by the backend (service role).
//
// The two mailboxes never mix: a guest is written to from guestrelations@, owners, clients and everyone else from
// ownerrelations@ (documentMailbox). The server works the mailbox out again from who the email is for and sends nothing
// when it differs from the database's choice.
//
// Document emails have their own switch (documentEmailReady: RESEND_API_KEY set, DOCUMENT_EMAIL_ENABLED not `false`), so
// they do not depend on EMAIL_REPLIES_ENABLED, which switches replies to guests and owners on and off.
const mailboxSchema = z.enum(['guest', 'owner']);
const startedSchema = z.object({ send: z.boolean(), requestId: z.string().uuid().optional(), mailbox: mailboxSchema.optional(), email: z.object({ to: z.string().email(), name: z.string() }).optional(), document: z.unknown() });
const receivableStartedSchema = z.object({ send: z.boolean(), status: z.string(), requestId: z.string().uuid(), mailbox: mailboxSchema, recipientKind: z.enum(RECIPIENT_TYPES),
  email: z.object({ to: z.string().email(), name: z.string() }), receivable: receivableItemSchema, paymentDetails: z.string() });
const SWITCHED_OFF = 'Sending email from Recharge is switched off. Download it and share it instead.';

const base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
// The email for one document: a short note and the document attached.
export function invoiceEmail(invoice: RechargeInvoice, recipientName: string, origin?: string) {
  const view = rechargeInvoiceDoc(invoice), request = invoice.kind === 'request', number = invoice.number ?? '';
  const total = docMoney(invoice.lines.reduce((t, l) => t + l.amountMinor, 0) - (invoice.paidSoFarMinor ?? 0), invoice.currency), first = recipientName.trim().split(/\s+/)[0] || 'there';
  const due = invoice.dueOn ? docDay(invoice.dueOn) : '';
  const subject = `${view.title} ${number} from ${groupTradingName}`.replace(/\s+/g, ' ');
  const text = [
    `Hello ${first},`,
    request
      ? `Please find attached our request for invoice ${number}. Please send us your invoice for ${total}${due ? ` by ${due}` : ''}, quoting ${number}.`
      : `Please find attached invoice ${number} from ${groupTradingName} for ${total}${due ? `, due ${due}` : ''}.`,
    'Open the attached file in a web browser to view it, print it or save it as a PDF.',
    `Thank you,\n${groupTradingName}`,
  ].join('\n\n').replace(/ {2,}/g, ' ').replace(/ ([.,])/g, '$1');
  return { subject, text, attachment: { filename: rechargeInvoiceFileName(invoice), content: base64(rechargeInvoiceHtml(invoice, { origin })), contentType: 'text/html' } };
}
export const documentEmail = (doc: z.infer<typeof makerDocumentSchema>, origin?: string) => invoiceEmail(fromMakerDocument(doc), doc.recipient.name, origin);

async function deliver(account: RpcContext['account'], requestId: string, mailbox: 'guest' | 'owner', to: string, mail: ReturnType<typeof invoiceEmail> | null, failure: string) {
  let messageId: string | null = null;
  if (!failure && mail) {
    try { messageId = (await sendMailboxEmail(mailbox, { to, subject: mail.subject, text: mail.text, attachments: [mail.attachment], idempotencyKey: `recharge-document/${requestId}` })).messageId; }
    catch (error) { failure = resendErrorMessage(error); }
  }
  let recorded = true;
  try { await securityRpc('workspace_document_send_result', { input: { requestId, sentBy: account.userId, ok: !failure, ...(messageId ? { messageId } : {}), ...(failure ? { error: failure } : {}) } }); }
  catch { recorded = false; }
  return { failure, recorded };
}

export async function emailDocument({ client, account }: RpcContext, input: Extract<DocumentsAction, { action: 'sendDocument' }>) {
  if (!documentEmailReady()) return businessResponse({ error: SWITCHED_OFF, mode: 'unconfigured' }, 503);
  const started = await client.rpc('workspace_documents_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = startedSchema.safeParse(started.data);
  if (!state.success) return businessResponse({ error: 'The document could not be sent. Refresh and try again.' }, 502);
  if (!state.data.send) return businessResponse({ ok: true, data: state.data.document });
  const doc = makerDocumentSchema.safeParse(state.data.document);
  const mailbox = doc.success ? documentMailbox(doc.data.recipient.kind) : null;
  let failure = '';
  if (!state.data.email || !doc.success || !doc.data.number) failure = 'This document has no address to send to.';
  else if (!mailbox || state.data.mailbox !== mailbox) failure = 'Not sent: the mailbox did not match who it is for.';
  const result = await deliver(account, input.requestId, mailbox ?? 'owner', state.data.email?.to ?? '', !failure && doc.success ? documentEmail(doc.data, authSecurityConfiguration()?.origin) : null, failure);
  if (result.failure) return businessResponse({ error: result.failure }, 502);
  return businessResponse({ ok: true, data: state.data.document, ...(result.recorded ? {} : { note: 'Sent. Refresh to see it recorded here.' }) });
}

// A Receivable invoice: to its owner or client from ownerrelations@, or to the guest of its stay from guestrelations@.
export async function emailReceivable({ client, account }: RpcContext, input: Extract<DocumentsAction, { action: 'emailReceivable' }>) {
  if (!documentEmailReady()) return businessResponse({ error: SWITCHED_OFF, mode: 'unconfigured' }, 503);
  const started = await client.rpc('workspace_documents_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = receivableStartedSchema.safeParse(started.data);
  if (!state.success) return businessResponse({ error: 'The invoice could not be sent. Refresh and try again.' }, 502);
  if (!state.data.send) return businessResponse({ ok: true, data: { status: state.data.status } });
  const mailbox = documentMailbox(state.data.recipientKind);
  const failure = state.data.mailbox !== mailbox ? 'Not sent: the mailbox did not match who it is for.' : '';
  const invoice = fromReceivable(state.data.receivable, state.data.paymentDetails);
  const result = await deliver(account, input.requestId, mailbox, state.data.email.to, failure ? null : invoiceEmail(invoice, state.data.email.name, authSecurityConfiguration()?.origin), failure);
  if (result.failure) return businessResponse({ error: result.failure }, 502);
  // Emailed: the invoice is sent, marked the same way Mark sent does (moveHubItem, with its version and history). One
  // already sent is left as it is.
  let marked = true;
  if (state.data.receivable.status === 'to_send') {
    const move = await client.rpc('workspace_teams_action', { input: { action: 'moveHubItem', requestId: crypto.randomUUID(), id: state.data.receivable.itemId, version: state.data.receivable.version, status: 'sent' } });
    marked = !move.error;
  }
  const note = !marked ? 'Emailed, but it could not be marked sent. Refresh and use Mark sent.' : result.recorded ? '' : 'Sent. Refresh to see it recorded here.';
  return businessResponse({ ok: true, data: { status: 'sent', marked }, ...(note ? { note } : {}) });
}

export const workspaceDocuments = rpcRoute({
  readSchema: documentsReadSchema, actionSchema: documentsActionSchema, bodyLimit: 131_072, unavailable: 'Invoices are temporarily unavailable',
  read: (client, input) => client.rpc('workspace_documents_read', { section: input.section, target_id: input.id ?? null }),
  // Email goes out from here; everything else (and sending in the app or recording a download) is the database's.
  handle: (context, input) => input.action === 'sendDocument' && input.channel === 'email' ? emailDocument(context, input)
    : input.action === 'emailReceivable' ? emailReceivable(context, input) : null,
  action: 'workspace_documents_action',
});
