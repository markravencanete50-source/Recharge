import { z } from 'zod';
import { rpcRoute } from './workspace-rpc-route';

// Owner email from an address Recharge does not know yet waits here for Client relations: read the list, then assign it to an owner
// (their address is remembered, so their next emails land in the conversation by themselves) or dismiss it.
const uuid = z.string().uuid();
export const workspaceEmailInbox = rpcRoute({
  readSchema: z.object({}).strict(),
  actionSchema: z.discriminatedUnion('action', [
    z.object({ action: z.literal('assign'), id: z.string().min(1).max(200), ownerId: uuid }).strict(),
    z.object({ action: z.literal('dismiss'), id: z.string().min(1).max(200) }).strict(),
  ]),
  bodyLimit: 2048, unavailable: 'Email is temporarily unavailable',
  read: client => client.rpc('workspace_email_unknown_read'),
  action: 'workspace_email_unknown_action',
});
