import { rpcRoute } from './workspace-rpc-route';
import { inboxActionSchema, inboxReadSchema } from './guest-inbox-policy';

export const workspaceGuestInbox = rpcRoute({
  readSchema: inboxReadSchema, actionSchema: inboxActionSchema, bodyLimit: 24_576, unavailable: 'The guest inbox is temporarily unavailable',
  // canSend comes from the server's switch, not the database: replies written in the app reach the guest through Hostaway.
  read: async (client, input) => {
    const result = await client.rpc('workspace_guest_inbox_read', input.section === 'list'
      ? { section: 'list', target: null, status_filter: input.status } : { section: 'thread', target: input.threadId, status_filter: null });
    if (result.error || !result.data || typeof result.data !== 'object') return result;
    return { ...result, data: { ...result.data, canSend: await import('./guest-reply-server').then(m => m.hostawayRepliesEnabled()), canSendEmail: await import('./resend-email').then(m => m.emailRepliesEnabled()) } };
  },
  // Sending goes to Hostaway as well as the database, so the server carries it out (lib/guest-reply-server.ts).
  handle: (context, input) => input.action === 'sendReply' ? import('./guest-reply-server').then(m => m.sendGuestReply(context, input)) : null,
  action: 'workspace_guest_inbox_action',
});
