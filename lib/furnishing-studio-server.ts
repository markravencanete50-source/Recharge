import { rpcRoute } from './workspace-rpc-route';
import { furnishingActionSchema, furnishingReadSchema } from './furnishing-studio';

// Furnishing Studio (migration 20261023200000): the catalogue, projects (quotes), the shopping list and the analytics, all
// through checked database functions. The database decides who may use it (the Stays team and management only); this
// route checks the session, the quota and the shape of each request.
export const FURNISHING_READ_RPC = 'workspace_furnishing_read';
export const FURNISHING_ANALYTICS_RPC = 'workspace_furnishing_analytics';
export const FURNISHING_ACTION_RPC = 'workspace_furnishing_action';
export const workspaceFurnishing = rpcRoute({
  readSchema: furnishingReadSchema, actionSchema: furnishingActionSchema, bodyLimit: 131_072, unavailable: 'Furnishing Studio is temporarily unavailable',
  read: (client, input) => input.section === 'analytics' ? client.rpc(FURNISHING_ANALYTICS_RPC, { start_on: input.from, end_on: input.to })
    : client.rpc(FURNISHING_READ_RPC, { section: input.section, target_id: input.id ?? null }),
  action: FURNISHING_ACTION_RPC,
});
