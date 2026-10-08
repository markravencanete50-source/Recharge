import { rpcRoute } from './workspace-rpc-route';
import { chatActionSchema, chatReadSchema } from './workspace-chat-policy';

export const workspaceChat = rpcRoute({
  readSchema: chatReadSchema, actionSchema: chatActionSchema, bodyLimit: 16_384, unavailable: 'Messages are temporarily unavailable',
  read: (client, input) => input.section === 'clientRelations'
    ? client.rpc('workspace_client_relations_read', { start_on: input.from, end_on: input.to })
    : client.rpc('workspace_chat_read', { section: input.section, target: input.section === 'messages' ? input.conversationId : null, before_at: input.section === 'messages' ? input.before ?? null : null }),
  action: 'workspace_chat_action',
});
