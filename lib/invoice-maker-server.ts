import { securityRpc, authSecurityConfiguration } from './auth-security';
import { businessResponse, databaseFailure } from './business-server';
import { documentsActionSchema, documentsReadSchema, fromMakerDocument, makerDocumentSchema, type DocumentsAction } from './invoice-maker';
import { docDay, docMoney, rechargeInvoiceDoc, rechargeInvoiceFileName, rechargeInvoiceHtml } from './recharge-invoice';
import { groupTradingName } from './legal-details';
import { emailRepliesEnabled, resendErrorMessage, sendMailboxEmail } from './resend-email';
import { rpcRoute, type RpcContext } from './workspace-rpc-route';
import { z } from 'zod';

// The Documents route: Recharge's invoices and the invoice maker (migration 20261022100000). The database decides who may
// read and do what. Emailing a document is done here: the database checks the recipient (never a cleaner, never a draft)
// and records a pending send; the email goes out from ownerrelations@ (the owners' and clients' mailbox, never
// guestrelations@) with the document attached as an HTML page; the outcome is recorded by the backend (service role).
const startedSchema = z.object({ send: z.boolean(), requestId: z.string().uuid().optional(), email: z.object({ to: z.string().email(), name: z.string() }).optional(), document: z.unknown() });

const base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
export function documentEmail(doc: z.infer<typeof makerDocumentSchema>, origin?: string) {
  const invoice = fromMakerDocument(doc), view = rechargeInvoiceDoc(invoice), request = doc.kind === 'request';
  const total = docMoney(doc.totalMinor, doc.currency), first = doc.recipient.name.trim().split(/\s+/)[0] || 'there';
  const subject = `${view.title} ${doc.number} from ${groupTradingName}`;
  const text = [
    `Hello ${first},`,
    request
      ? `Please find attached our request for invoice ${doc.number}. Please send ${groupTradingName} your invoice for ${total} by ${docDay(doc.dueOn)}, quoting ${doc.number}.`
      : `Please find attached invoice ${doc.number} from ${groupTradingName} for ${total}, due ${docDay(doc.dueOn)}.`,
    'Open the attached file in a web browser to view it, print it or save it as a PDF.',
    `Thank you,\n${groupTradingName}`,
  ].join('\n\n');
  return { subject, text, attachment: { filename: rechargeInvoiceFileName(invoice), content: base64(rechargeInvoiceHtml(invoice, { origin })), contentType: 'text/html' } };
}

export async function emailDocument({ client, account }: RpcContext, input: Extract<DocumentsAction, { action: 'sendDocument' }>) {
  if (!emailRepliesEnabled()) return businessResponse({ error: 'Sending email from Recharge is switched off. Download it and share it instead.', mode: 'unconfigured' }, 503);
  const started = await client.rpc('workspace_documents_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = startedSchema.safeParse(started.data);
  if (!state.success) return businessResponse({ error: 'The document could not be sent. Refresh and try again.' }, 502);
  if (!state.data.send) return businessResponse({ ok: true, data: state.data.document });
  const doc = makerDocumentSchema.safeParse(state.data.document);
  let messageId: string | null = null, failure = '';
  if (!state.data.email || !doc.success || !doc.data.number) failure = 'This document has no address to send to.';
  else {
    try {
      const mail = documentEmail(doc.data, authSecurityConfiguration()?.origin);
      messageId = (await sendMailboxEmail('owner', { to: state.data.email.to, subject: mail.subject, text: mail.text, attachments: [mail.attachment], idempotencyKey: `recharge-document/${input.requestId}` })).messageId;
    } catch (error) { failure = resendErrorMessage(error); }
  }
  let recorded = true;
  try { await securityRpc('workspace_document_send_result', { input: { requestId: input.requestId, sentBy: account.userId, ok: !failure, ...(messageId ? { messageId } : {}), ...(failure ? { error: failure } : {}) } }); }
  catch { recorded = false; }
  if (failure) return businessResponse({ error: failure }, 502);
  return businessResponse({ ok: true, data: state.data.document, ...(recorded ? {} : { note: 'Sent. Refresh to see it recorded here.' }) });
}

export const workspaceDocuments = rpcRoute({
  readSchema: documentsReadSchema, actionSchema: documentsActionSchema, bodyLimit: 131_072, unavailable: 'Invoices are temporarily unavailable',
  read: (client, input) => client.rpc('workspace_documents_read', { section: input.section, target_id: input.id ?? null }),
  // Email goes out from here; everything else (and sending in the app or recording a download) is the database's.
  handle: (context, input) => input.action === 'sendDocument' && input.channel === 'email' ? emailDocument(context, input) : null,
  action: 'workspace_documents_action',
});
