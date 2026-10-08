import { z } from 'zod';
import { rpcRoute } from './workspace-rpc-route';
import { businessResponse } from './business-server';
import { ownerReadSchema } from './owner-policy';

// Owner reports are read only: the routes answer GET, and any update is refused.
export const workspaceOwner = rpcRoute({
  readSchema: ownerReadSchema, actionSchema: z.unknown(), bodyLimit: 1024, unavailable: 'Owner reports are temporarily unavailable',
  read: (client, input) => client.rpc('workspace_owner_bookings', { start_on: input.from, end_on: input.to }),
  handle: () => Promise.resolve(businessResponse({ error: 'Owner reports are read only' }, 405)),
  action: 'workspace_owner_bookings',
});
