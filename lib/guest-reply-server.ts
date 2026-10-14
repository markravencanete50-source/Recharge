import { env } from 'cloudflare:workers';
import { securityRpc } from './auth-security';
import { businessResponse, databaseFailure } from './business-server';
import { hostawayReplyErrorMessage, sendHostawayConversationMessage } from './hostaway';
import { emailRepliesEnabled, resendErrorMessage, sendMailboxEmail } from './resend-email';
import { z } from 'zod';
import { hostawaySyncConfigured } from './hostaway-sync';
import type { InboxAction } from './guest-inbox-policy';
import type { RpcContext } from './workspace-rpc-route';

// Replies written in the Guest inbox, delivered to the guest through Hostaway (Hostaway conversations) or through Resend as
// guestrelations@rechargegroup.co.uk (email conversations). Hostaway works only while the Hostaway sync is on AND
// HOSTAWAY_REPLIES_ENABLED is `true`; email only while RESEND_API_KEY is set AND EMAIL_REPLIES_ENABLED is `true` (Worker secrets, off by default).
// The database checks who may reply and records each Send once (by request id); the provider is called only after that, and the
// outcome is written back through the service-role-only workspace_guest_reply_result / workspace_email_reply_result.
export const hostawayRepliesEnabled = () => hostawaySyncConfigured() && String((env as unknown as Record<string, string | undefined>).HOSTAWAY_REPLIES_ENABLED || '') === 'true';
export const repliesEnabled = () => hostawayRepliesEnabled() || emailRepliesEnabled();

const emailSchema = z.object({ to: z.string().email(), subject: z.string().nullable().optional(), inReplyTo: z.string().nullable().optional(), references: z.array(z.string()).default([]) });
type Started = { send: false; thread: unknown } | { send: true; conversationId: string; requestId: string; source?: string; email?: unknown };

export async function sendGuestReply({ client }: RpcContext, input: Extract<InboxAction, { action: 'sendReply' }>) {
  if (!repliesEnabled()) return businessResponse({ error: 'Sending replies from Recharge is switched off. Reply in Hostaway or your mail app for now.', mode: 'unconfigured' }, 503);
  const started = await client.rpc('workspace_guest_inbox_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = started.data as Started;
  // This request was already sent or is still going out: nothing is posted again.
  if (!state.send) return businessResponse({ data: state.thread, ok: true });
  const byEmail = state.source === 'email';
  const switchedOff = byEmail ? !emailRepliesEnabled() : !hostawayRepliesEnabled();
  let messageId: string | null = null, failure = '';
  if (switchedOff) failure = byEmail ? 'Sending email replies from Recharge is switched off. Reply from your mail app for now.' : 'Sending replies from Recharge is switched off. Reply in Hostaway for now.';
  else if (byEmail) {
    const email = emailSchema.safeParse(state.email);
    if (!email.success) failure = 'This email conversation has no address to reply to.';
    else {
      try {
        const out = await sendMailboxEmail('guest', { to: email.data.to, subject: email.data.subject || 'Re: your message', text: input.body, inReplyTo: email.data.inReplyTo, references: email.data.references, idempotencyKey: `recharge-guest-reply/${input.requestId}` });
        messageId = out.messageId;
      } catch (error) { failure = resendErrorMessage(error); }
    }
  } else {
    try { messageId = await sendHostawayConversationMessage(state.conversationId, input.body); }
    catch (error) { failure = hostawayReplyErrorMessage(error); }
  }
  let recorded = true;
  try {
    if (byEmail) await securityRpc('workspace_email_reply_result', { input: { requestId: input.requestId, ok: !failure, ...(messageId ? { messageId } : {}), ...(failure ? { error: failure } : {}) } });
    else await securityRpc('workspace_guest_reply_result', { input: { requestId: input.requestId, ok: !failure, ...(messageId ? { hostawayMessageId: messageId } : {}), ...(failure ? { error: failure } : {}) } });
  } catch { recorded = false; }
  if (failure) return businessResponse({ error: failure }, switchedOff ? 503 : 502);
  // Delivered, but Recharge couldn't note it: the next Hostaway import brings the message in (an email reply is noted on the next press only).
  if (!recorded) return businessResponse({ ok: true, data: null, note: byEmail ? 'Sent to the guest. Refresh to see it here.' : 'Sent to the guest. It will show here within a minute.' });
  const fresh = await client.rpc('workspace_guest_inbox_read', { section: 'thread', target: input.threadId, status_filter: null });
  return businessResponse({ ok: true, data: (fresh.data as { thread?: unknown } | null)?.thread ?? null });
}
