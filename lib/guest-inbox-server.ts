import { rpcRoute } from './workspace-rpc-route';
import { inboxActionSchema, inboxReadSchema } from './guest-inbox-policy';

export const workspaceGuestInbox = rpcRoute({
  readSchema: inboxReadSchema, actionSchema: inboxActionSchema, bodyLimit: 24_576, unavailable: 'The guest inbox is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_guest_inbox_read', input.section === 'list'
    ? { section: 'list', target: null, status_filter: input.status } : { section: 'thread', target: input.threadId, status_filter: null }),
  action: 'workspace_guest_inbox_action',
});
