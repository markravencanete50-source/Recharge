import { rpcRoute } from './workspace-rpc-route';
import { launchActionSchema, launchQuerySchema } from './launch-preparation';

// Launch Preparation: the settings, a property's checklist, and a housekeeper's readiness inspections. Authority lives in
// the database (migration 20261029100000).
export const workspaceLaunch = rpcRoute({
  readSchema: launchQuerySchema, actionSchema: launchActionSchema, bodyLimit: 80_000, unavailable: 'Launch Preparation is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_launch_read', { target: input.propertyId ?? null }),
  action: 'workspace_launch_action',
});
