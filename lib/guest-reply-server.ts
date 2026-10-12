import { env } from 'cloudflare:workers';
import { securityRpc } from './auth-security';
import { businessResponse, databaseFailure } from './business-server';
import { hostawayReplyErrorMessage, sendHostawayConversationMessage } from './hostaway';
import { hostawaySyncConfigured } from './hostaway-sync';
import type { InboxAction } from './guest-inbox-policy';
import type { RpcContext } from './workspace-rpc-route';

// Replies written in the Guest inbox, delivered to the guest through Hostaway. Works only while the
// Hostaway sync is on AND HOSTAWAY_REPLIES_ENABLED is `true` (a Worker variable, off by default).
// The database checks who may reply and records each Send once (by request id); Hostaway is called only
// after that, and the outcome is written back through the service-role-only workspace_guest_reply_result.
export const repliesEnabled = () => hostawaySyncConfigured() && String((env as unknown as Record<string, string | undefined>).HOSTAWAY_REPLIES_ENABLED || '') === 'true';

type Started = { send: false; thread: unknown } | { send: true; conversationId: string; requestId: string };

export async function sendGuestReply({ client }: RpcContext, input: Extract<InboxAction, { action: 'sendReply' }>) {
  if (!repliesEnabled()) return businessResponse({ error: 'Sending replies from Recharge is switched off. Reply in Hostaway for now.', mode: 'unconfigured' }, 503);
  const started = await client.rpc('workspace_guest_inbox_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = started.data as Started;
  // This request was already sent or is still going out: nothing is posted again.
  if (!state.send) return businessResponse({ data: state.thread, ok: true });
  let messageId: string | null = null, failure = '';
  try { messageId = await sendHostawayConversationMessage(state.conversationId, input.body); }
  catch (error) { failure = hostawayReplyErrorMessage(error); }
  let recorded = true;
  try { await securityRpc('workspace_guest_reply_result', { input: { requestId: input.requestId, ok: !failure, ...(messageId ? { hostawayMessageId: messageId } : {}), ...(failure ? { error: failure } : {}) } }); }
  catch { recorded = false; }
  if (failure) return businessResponse({ error: failure }, 502);
  // Delivered, but Recharge couldn't note it: the next Hostaway import brings the message in.
  if (!recorded) return businessResponse({ ok: true, data: null, note: 'Sent to the guest. It will show here within a minute.' });
  const fresh = await client.rpc('workspace_guest_inbox_read', { section: 'thread', target: input.threadId, status_filter: null });
  return businessResponse({ ok: true, data: (fresh.data as { thread?: unknown } | null)?.thread ?? null });
}
