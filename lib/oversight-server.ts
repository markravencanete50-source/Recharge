import { rpcRoute } from './workspace-rpc-route';
import { oversightActionSchema, oversightReadSchema } from './oversight-policy';

// Management oversight: the business overview, an item's history and the decisions report, plus
// management's reminders and approvals. Authority lives in the database.
export const workspaceOversight = rpcRoute({
  readSchema: oversightReadSchema, actionSchema: oversightActionSchema, bodyLimit: 8_192, unavailable: 'Management oversight is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_oversight_read', { section: input.section, target: input.section === 'history' ? input.workId : null }),
  action: 'workspace_oversight_action',
});
