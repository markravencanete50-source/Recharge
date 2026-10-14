import { securityRpc } from './auth-security';
import { businessResponse, databaseFailure } from './business-server';
import { clientEmailActionSchema, clientEmailReadSchema, type ClientEmailAction } from './client-email-policy';
import { emailRepliesEnabled, resendErrorMessage, sendMailboxEmail } from './resend-email';
import { rpcRoute, type RpcContext } from './workspace-rpc-route';
import { z } from 'zod';

// Client email conversations (email to ownerrelations@ from someone who is not an owner yet). The database decides who may read and
// answer (admins, super admins, the client relations rota) and records each Send once; the reply goes out from ownerrelations@ with
// In-Reply-To and References, and is stored only once Resend accepted it (workspace_client_email_result, service role only).
const emailSchema = z.object({ to: z.string().email(), subject: z.string(), inReplyTo: z.string().nullable().optional(), references: z.array(z.string()).default([]) });
type Started = { send: false; thread: unknown } | { send: true; requestId: string; email: unknown };

export async function sendClientEmailReply({ client }: RpcContext, input: Extract<ClientEmailAction, { action: 'reply' }>) {
  if (!emailRepliesEnabled()) return businessResponse({ error: 'Sending email from Recharge is switched off. Reply from your mail app for now.', mode: 'unconfigured' }, 503);
  const started = await client.rpc('workspace_client_email_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = started.data as Started;
  if (!state.send) return businessResponse({ ok: true, data: state.thread });
  const email = emailSchema.safeParse(state.email);
  let messageId: string | null = null, failure = '';
  if (!email.success) failure = 'This conversation has no address to reply to.';
  else {
    try {
      messageId = (await sendMailboxEmail('owner', { to: email.data.to, subject: email.data.subject, text: input.body, inReplyTo: email.data.inReplyTo, references: email.data.references, idempotencyKey: `recharge-client-email/${input.requestId}` })).messageId;
    } catch (error) { failure = resendErrorMessage(error); }
  }
  let recorded = true;
  try { await securityRpc('workspace_client_email_result', { input: { requestId: input.requestId, ok: !failure, ...(messageId ? { messageId } : {}), ...(failure ? { error: failure } : {}) } }); }
  catch { recorded = false; }
  if (failure) return businessResponse({ error: failure }, 502);
  if (!recorded) return businessResponse({ ok: true, data: null, note: 'Sent. Refresh to see it here.' });
  return businessResponse({ ok: true, data: null });
}

export const workspaceClientEmail = rpcRoute({
  readSchema: clientEmailReadSchema, actionSchema: clientEmailActionSchema, bodyLimit: 24_576, unavailable: 'Client email is temporarily unavailable',
  read: async (client, input) => {
    const result = await client.rpc('workspace_client_email_read', input.section === 'list' ? { section: 'list', target: null } : { section: 'thread', target: input.threadId });
    if (result.error || !result.data || typeof result.data !== 'object') return result;
    return { ...result, data: { ...result.data, canSend: emailRepliesEnabled() } };
  },
  handle: (context, input) => input.action === 'reply' ? sendClientEmailReply(context, input) : null,
  action: 'workspace_client_email_action',
});
