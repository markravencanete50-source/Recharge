import { rpcRoute } from './workspace-rpc-route';
import { ownerActionSchema, ownerReadSchema } from './owner-policy';

// Owner reports are read only. The one update is an owner's own monthly expense (saved or removed), checked by the database.
export const workspaceOwner = rpcRoute({
  readSchema: ownerReadSchema, actionSchema: ownerActionSchema, bodyLimit: 4096, unavailable: 'Owner reports are temporarily unavailable',
  read: (client, input) => input.section === 'periods'
    ? client.rpc('workspace_owner_periods', { start_month: input.from, end_month: input.to })
    : client.rpc('workspace_owner_bookings', { start_on: input.from, end_on: input.to }),
  action: 'workspace_owner_save_expense',
  actionFor: input => input.action === 'removeOwnerExpense' ? 'workspace_owner_remove_expense' : 'workspace_owner_save_expense',
});
